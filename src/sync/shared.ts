/**
 * 同步共用管线(外部插件 → Tag 实验室)。
 *
 * 各来源适配器只负责把对方的数据读出来、规整成统一的 SyncPayload(画师串 / vibe / 组),
 * 合并语义全部收口在 applySyncPayload,保证各来源口径一致:
 *
 * - 画师串:按 **name** 重名覆盖(保留画板内部 id,历史记录引用不断);部分来源 id 体系与
 *   画板互通,名称对不上时再用来源 id 兜底。幂等:重复点 = 同名再覆盖一次。
 * - 预览图:来源带预览图就覆盖/补载,来源没有则保留画板已有。存 IndexedDB,不进 localStorage。
 * - vibe:按 encodings 指纹去重;已存在则只补缺的模型编码/原图/缩略图,不重复入库;
 *   新导入的 vibe 一律 **不启用**(避免同步后立即改变出图),用户手动套用组才生效。
 * - 组:按组名聚合,跨来源取并集(同成员以来源的勾选/强度为准)。
 */
import { clampVibeStrength } from '@/constants';
import { artistPreviews, setArtistPreview } from '@/state/artistPreviews';
import { newId, settings } from '@/state/settings';
import { makeThumbnail } from '@/state/ui';
import { loadVibes, vibeList } from '@/state/vibeList';
import { saveVibe } from '@/storage/vibes';
import type { TlbArtistPreset, TlbVibe, TlbVibeEncodings, TlbVibeGroupMember } from '@/types';

/* ════════════════════════════════ 统一中间结构 ════════════════════════════════ */

export interface IncomingArtist {
  name: string;
  prompt: string;
  quality: string;
  negative: string;
  /** 原始预览图(dataURL 或同源可加载 URL;空串 = 该来源无预览图)。引擎统一压成 256 jpeg。 */
  preview: string;
  /** 来源插件内的稳定 id;名称对不上时按 id 兜底匹配。 */
  sourceId?: string;
  /**
   * 来源 id 与画板 id 体系互通:新建条目时直接沿用 sourceId 作为画板内部 id。
   * 其余来源为外部 id,不可沿用。
   */
  trustSourceId?: boolean;
}

export interface IncomingVibe {
  /** 来源插件内的 vibe id(组成员用它回连);可空。 */
  sourceId?: string;
  name: string;
  /** 参考原图 base64(无 data: 前缀)。 */
  image: string;
  /** 缩略图 dataURL(可空)。 */
  thumbnail: string;
  encodings: TlbVibeEncodings;
  strength: number;
}

export interface IncomingGroupMember {
  sourceVibeId: string;
  enabled: boolean;
  strength: number;
}

export interface IncomingGroup {
  name: string;
  members: IncomingGroupMember[];
}

export interface SyncPayload {
  artists: IncomingArtist[];
  vibes: IncomingVibe[];
  groups: IncomingGroup[];
}

export interface SyncReport {
  artistsImported: number;
  artistsUpdated: number;
  artistsSkipped: number;
  previewsAdded: number;
  previewsUpdated: number;
  /** 來源帶了預覽圖但載入/壓縮失敗的條數。 */
  previewsFailed: number;
  vibesImported: number;
  vibesUpdated: number;
  vibesSkipped: number;
  /** 引用存在但数据取不到 / 解析失败的 vibe 条数。 */
  vibesFailed: number;
  groupsAdded: number;
  groupsUpdated: number;
}

export function emptyReport(): SyncReport {
  return {
    artistsImported: 0,
    artistsUpdated: 0,
    artistsSkipped: 0,
    previewsAdded: 0,
    previewsUpdated: 0,
    previewsFailed: 0,
    vibesImported: 0,
    vibesUpdated: 0,
    vibesSkipped: 0,
    vibesFailed: 0,
    groupsAdded: 0,
    groupsUpdated: 0,
  };
}

/* ════════════════════════════════ 取值/编码小工具 ════════════════════════════════ */

export const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

function base64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** dataURL → 其承载的文本(base64 或 urlencode 两种壳都解)。 */
export function decodeDataUrlText(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return '';
  const header = dataUrl.slice(0, comma);
  const data = dataUrl.slice(comma + 1);
  return header.includes(';base64') ? base64ToUtf8(data) : decodeURIComponent(data);
}

/** 裸 base64 / dataURL 统一成 dataURL(已是 dataURL 原样返回)。 */
export function ensureDataUrl(raw: unknown, mime = 'image/jpeg'): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (s.startsWith('data:')) return s;
  return `data:${mime};base64,${s}`;
}

/** 去掉 dataURL 的 mime 头,只留 base64(本来就没头则原样)。 */
export function stripDataUrlPrefix(raw: unknown): string {
  const s = String(raw ?? '').trim();
  const comma = s.indexOf(',');
  return s.startsWith('data:') && comma >= 0 ? s.slice(comma + 1) : s;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(blob);
  });
}

const FETCH_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(path: string): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(path, { signal: controller.signal, cache: 'no-cache' });
    return resp.ok ? resp : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 取服务器文本:按 data: / JSON / 裸 base64 尝试解码。 */
export async function fetchServerText(path: string): Promise<string | null> {
  const resp = await fetchWithTimeout(path);
  if (!resp) return null;
  const text = await resp.text();
  if (text.startsWith('data:')) return decodeDataUrlText(text);
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return text;
  try {
    return base64ToUtf8(trimmed);
  } catch {
    return text;
  }
}

/** 取服务器图片为 dataURL(同源 /user/images 路径或图片字节)。 */
export async function fetchServerImageDataUrl(path: string): Promise<string> {
  const resp = await fetchWithTimeout(path);
  if (!resp) return '';
  const blob = await resp.blob();
  if (!blob || blob.size === 0) return '';
  return blobToDataUrl(blob);
}

/**
 * 載入伺服器圖片並統一壓成 256px jpeg dataURL。
 * 先 fetch 位元組(部分宿主環境 fetch 被 CSP/權限攔截會回 null);
 * 失敗則退回直接讓 Image 載入同網址進 canvas —— 柏宝绘自己就是用 <img> 顯示,
 * 只要它能顯示,這個路徑就能畫進 canvas(同源不污染)。
 */
export async function loadServerImageThumb(path: string): Promise<string> {
  if (!path) return '';
  // 同源相對路徑候選:原樣、補根斜線(宿主頁面不在根路徑時相對解析會歪)
  const candidates = [path];
  if (/^[\w.-]+(\/|\\)/.test(path) && !path.startsWith('/')) candidates.push(`/${path}`);
  for (const p of candidates) {
    const direct = await fetchServerImageDataUrl(p);
    if (direct) {
      const t = await makeThumbnail(direct);
      if (t) return t;
    }
    // fetch 拿不到就照柏宝绘自己的方式用 <img> 載入(同源可畫進 canvas)
    try {
      const t = await makeThumbnail(p);
      if (t) return t;
    } catch {
      /* 試下一個候選 */
    }
  }
  return '';
}

/* ════════════════════════════════ 跨插件 IndexedDB 直读 ════════════════════════════════ */

/**
 * 直读其它插件的 IndexedDB(只读单条记录)。version 不传 = 不带版本号打开,
 * 避免在对方库上触发 upgrade。打开失败 / 无此 store / 无记录一律返回 null(只读,绝不打扰对方)。
 */
export async function readExternalStore(
  dbName: string,
  storeName: string,
  key: string,
  version?: number,
): Promise<unknown> {
  const db = await new Promise<IDBDatabase | null>(resolve => {
    let req: IDBOpenDBRequest;
    try {
      req = typeof version === 'number' ? indexedDB.open(dbName, version) : indexedDB.open(dbName);
    } catch {
      resolve(null);
      return;
    }
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  if (!db) return null;
  try {
    if (!db.objectStoreNames.contains(storeName)) return null;
    return await new Promise<unknown>(resolve => {
      try {
        const get = db.transaction([storeName], 'readonly').objectStore(storeName).get(key);
        get.onsuccess = () => resolve(get.result ?? null);
        get.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  } finally {
    db.close();
  }
}

/* ════════════════════════════════ 读宿主扩展设置 ════════════════════════════════ */

/** 读 SillyTavern extensionSettings[key];未安装/未打开过 → 抛错。 */
export function readExtensionSettings(key: string): Record<string, unknown> {
  const st = (window as unknown as { SillyTavern?: { getContext?: () => unknown } }).SillyTavern;
  const ctx = st?.getContext?.() as { extensionSettings?: Record<string, unknown> } | undefined;
  const stored = ctx?.extensionSettings?.[key];
  if (!stored || typeof stored !== 'object') {
    throw new Error(`读不到 ${key} 的数据:请确认对应插件已安装并在本酒馆至少打开过一次`);
  }
  return stored as Record<string, unknown>;
}

/* ════════════════════════════════ .naiv4vibe 解析 / 指纹 ════════════════════════════════ */

export interface ParsedNaivVibe {
  name: string;
  image: string;
  thumbnail: string;
  encodings: TlbVibeEncodings;
  strength: number;
}

/** 解析官方 .naiv4vibe JSON 文本。 */
export function parseNaiv4vibe(text: string): ParsedNaivVibe {
  let json: {
    identifier?: unknown;
    name?: unknown;
    image?: unknown;
    thumbnail?: unknown;
    encodings?: Record<string, unknown>;
    importInfo?: { strength?: unknown };
  };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new Error('不是有效的 .naiv4vibe 文件(JSON 解析失败)');
  }
  if (json?.identifier !== 'novelai-vibe-transfer') {
    throw new Error('不是 NovelAI vibe 文件(缺少 novelai-vibe-transfer 标识)');
  }
  const encodings: TlbVibeEncodings = {};
  for (const [modelKey, group] of Object.entries(json.encodings ?? {})) {
    const first = Object.values(group as Record<string, unknown>)[0] as
      | { encoding?: unknown; params?: { information_extracted?: unknown } }
      | undefined;
    if (typeof first?.encoding === 'string' && first.encoding) {
      encodings[modelKey] = {
        encoding: first.encoding,
        infoExtracted: typeof first.params?.information_extracted === 'number'
          ? (first.params.information_extracted as number)
          : 1,
      };
    }
  }
  if (!Object.keys(encodings).length) throw new Error('vibe 文件里没有可用的编码数据');
  return {
    name: typeof json.name === 'string' && json.name ? json.name : '导入的 Vibe',
    image: typeof json.image === 'string' ? json.image : '',
    thumbnail: typeof json.thumbnail === 'string' ? json.thumbnail : '',
    encodings,
    strength: clampVibeStrength(json.importInfo?.strength, 0.6),
  };
}

/** vibe 去重指纹:模型 key 排序后取各编码前 64 字符。 */
export function vibeFingerprint(encodings: TlbVibeEncodings): string {
  return Object.keys(encodings)
    .sort()
    .map(key => `${key}:${encodings[key].encoding.slice(0, 64)}`)
    .join('|');
}

function firstInfoExtracted(encodings: TlbVibeEncodings): number {
  for (const key of Object.keys(encodings)) {
    const n = encodings[key]?.infoExtracted;
    if (n === 0) return 0;
  }
  return 1;
}

/* ════════════════════════════════ 合并引擎 ════════════════════════════════ */

async function storeArtistPreview(artistId: string, raw: string, hadPreview: boolean, r: SyncReport): Promise<boolean> {
  try {
    // 各家原图尺寸不一,统一压到 256px jpeg(对比页网格够用,IndexedDB 也轻)
    const url = await makeThumbnail(raw);
    if (!url) {
      r.previewsFailed++;
      return false;
    }
    await setArtistPreview(artistId, url);
    if (hadPreview) r.previewsUpdated++;
    else r.previewsAdded++;
    return true;
  } catch (e) {
    r.previewsFailed++;
    console.warn('[TagLab] 预览图同步失败', artistId, e);
    return false;
  }
}

/**
 * 把一个来源的统一负载合并进画板库(幂等,可反复调用)。
 * 副作用:改 settings.artistPresets / vibeGroups、写 vibes 与 artist-preview 两个 IndexedDB store、
 * 增量更新 vibeList.items。
 */
export async function applySyncPayload(payload: SyncPayload): Promise<SyncReport> {
  const r = emptyReport();
  if (!vibeList.loaded) await loadVibes();

  /* ---- 画师串:name 优先、sourceId 兜底 ---- */
  const byName = new Map<string, TlbArtistPreset>();
  const byId = new Map<string, TlbArtistPreset>();
  for (const a of settings.artistPresets) {
    const n = a.name.trim();
    if (n && !byName.has(n)) byName.set(n, a);
    byId.set(a.id, a);
  }

  for (const inc of payload.artists) {
    const name = inc.name.trim();
    if (!name) continue;
    const exist = byName.get(name) ?? (inc.sourceId ? byId.get(inc.sourceId) : undefined);
    if (exist) {
      const same =
        exist.name === name &&
        exist.prompt === inc.prompt &&
        exist.quality === inc.quality &&
        exist.negative === inc.negative;
      Object.assign(exist, { name, prompt: inc.prompt, quality: inc.quality, negative: inc.negative });
      if (same) r.artistsSkipped++;
      else r.artistsUpdated++;
      byName.set(name, exist);
      if (inc.preview) {
        const had = !!artistPreviewHas(exist.id);
        await storeArtistPreview(exist.id, inc.preview, had, r);
      }
    } else {
      const adoptId = inc.trustSourceId && inc.sourceId && !byId.has(inc.sourceId) ? inc.sourceId : newId('art');
      const item: TlbArtistPreset = {
        id: adoptId,
        name,
        prompt: inc.prompt,
        quality: inc.quality,
        negative: inc.negative,
      };
      settings.artistPresets.push(item);
      byName.set(name, item);
      byId.set(item.id, item);
      r.artistsImported++;
      if (inc.preview) await storeArtistPreview(item.id, inc.preview, false, r);
    }
  }

  /* ---- vibe:指纹去重 + 缺失编码补全 ---- */
  const byFp = new Map<string, TlbVibe>();
  for (const v of vibeList.items) {
    const fp = vibeFingerprint(v.encodings);
    if (fp) byFp.set(fp, v);
  }
  /** 来源 vibe id → 画板 vibe id(组成员回连用)。 */
  const sourceVibeIdMap = new Map<string, string>();

  for (const inc of payload.vibes) {
    if (!inc.encodings || !Object.keys(inc.encodings).length) {
      r.vibesFailed++;
      continue;
    }
    const fp = vibeFingerprint(inc.encodings);
    if (!fp) {
      r.vibesFailed++;
      continue;
    }
    const existing = byFp.get(fp);
    let vibeId: string;
    if (existing) {
      let changed = false;
      for (const [modelKey, enc] of Object.entries(inc.encodings)) {
        if (!existing.encodings[modelKey]) {
          existing.encodings[modelKey] = enc;
          changed = true;
        }
      }
      if (!existing.image && inc.image) {
        existing.image = inc.image;
        changed = true;
      }
      if (!existing.thumbnail && inc.thumbnail) {
        existing.thumbnail = inc.thumbnail;
        changed = true;
      }
      if (changed) {
        await saveVibe(existing);
        r.vibesUpdated++;
      } else {
        r.vibesSkipped++;
      }
      vibeId = existing.id;
    } else {
      const vibe: TlbVibe = {
        id: newId('vibe'),
        name: inc.name || '导入的 Vibe',
        image: inc.image,
        thumbnail: inc.thumbnail,
        encodings: inc.encodings,
        infoExtracted: firstInfoExtracted(inc.encodings),
        strength: clampVibeStrength(inc.strength, 0.6),
        enabled: false, // 导入只入库,不立即改变出图
        createdAt: Date.now(),
      };
      await saveVibe(vibe);
      vibeList.items.unshift(vibe);
      byFp.set(fp, vibe);
      r.vibesImported++;
      vibeId = vibe.id;
    }
    if (inc.sourceId) sourceVibeIdMap.set(inc.sourceId, vibeId);
  }

  /* ---- 组:按名聚合,跨来源取并集 ---- */
  for (const g of payload.groups) {
    const name = g.name.trim();
    if (!name) continue;
    const seen = new Set<string>();
    const incoming: TlbVibeGroupMember[] = [];
    for (const m of g.members) {
      const id = sourceVibeIdMap.get(m.sourceVibeId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      incoming.push({ id, enabled: m.enabled, strength: clampVibeStrength(m.strength, 0.6) });
    }
    if (!incoming.length) continue;
    const group = settings.vibeGroups.find(x => x.name.trim() === name);
    if (group) {
      const merged = new Map(group.members.map(m => [m.id, m]));
      for (const m of incoming) merged.set(m.id, m);
      group.members = [...merged.values()];
      r.groupsUpdated++;
    } else {
      settings.vibeGroups.push({ id: newId('vibegroup'), name: name.slice(0, 60), members: incoming });
      r.groupsAdded++;
    }
  }

  return r;
}

function artistPreviewHas(id: string): boolean {
  return !!artistPreviews[id];
}
