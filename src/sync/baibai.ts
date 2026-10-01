/**
 * 从柏宝绘手动同步配置(单向只读)。
 *
 * 点击同步按钮时读一次 `extensionSettings['baibai_image']`:NAI 配置(接入点/模型/采样器等)
 * 覆写进画板;画师串(含预览图)、vibe 与 vibe 组走 applySyncPayload 统一合并 ——
 * 画师串按 name 重名覆盖、id 兜底(柏宝绘 art_/bi_ id 与画板互通,新建时沿用);
 * vibe 按编码指纹增量合并,导入默认不启用。之后两边独立演化,画板不碰柏宝绘数据。
 */
import { clampVibeStrength, OFFICIAL_ENDPOINT_ID } from '@/constants';
import { newId, officialEndpoint, settings } from '@/state/settings';
import {
  applySyncPayload,
  fetchServerImageDataUrl,
  fetchServerText,
  readExternalStore,
  str,
  type IncomingArtist,
  type IncomingGroup,
  type IncomingVibe,
  type SyncPayload,
  type SyncReport,
} from '@/sync/shared';
import type { TlbNaiEndpoint, TlbVibeEncodings } from '@/types';

interface BaibaiEndpoint {
  id?: unknown;
  name?: unknown;
  url?: unknown;
  key?: unknown;
}

interface BaibaiArtist {
  id?: unknown;
  name?: unknown;
  prompt?: unknown;
  quality?: unknown;
  negative?: unknown;
  previewPath?: unknown;
}

/** 柏宝绘 vibe 索引(正文在 dataPath 指向的服务器 JSON 或 idb: 的 IndexedDB)。 */
interface BaibaiVibe {
  id?: unknown;
  name?: unknown;
  dataPath?: unknown;
  thumbnailPath?: unknown;
  strength?: unknown;
  enabled?: unknown;
  group?: unknown;
}

/** 柏宝绘 NaiSettings 中画板关心的字段(宽松类型:跨插件读值不做类型断言信任)。 */
interface BaibaiNaiShape {
  endpoints?: BaibaiEndpoint[];
  activeEndpointId?: unknown;
  model?: unknown;
  sampler?: unknown;
  steps?: unknown;
  scale?: unknown;
  cfgRescale?: unknown;
  noiseSchedule?: unknown;
  qualityTags?: unknown;
  undesiredContent?: unknown;
  varietyBoost?: unknown;
  portraitSize?: unknown;
  landscapeSize?: unknown;
  seed?: unknown;
  artistPresets?: BaibaiArtist[];
  vibes?: BaibaiVibe[];
  activeArtistId?: unknown;
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);

export class BaibaiSyncError extends Error {}

/** 读柏宝绘的设置对象;ST 未就绪 / 未安装柏宝绘 / 数据为空时抛错。 */
function readBaibaiNai(): BaibaiNaiShape {
  const st = (window as unknown as { SillyTavern?: { getContext?: () => unknown } }).SillyTavern;
  const ctx = st?.getContext?.() as { extensionSettings?: Record<string, unknown> } | undefined;
  const stored = ctx?.extensionSettings?.['baibai_image'] as { nai?: BaibaiNaiShape } | undefined;
  if (!stored || typeof stored !== 'object' || !stored.nai) {
    throw new BaibaiSyncError('读不到柏宝绘的设置:请确认柏宝绘已安装并至少打开过一次');
  }
  return stored.nai;
}

export interface BaibaiSyncReport extends SyncReport {
  endpoints: number;
}

/** 把柏宝绘 vibe 正文的 encodings(宽松)规整成画板结构。 */
function coerceEncodings(raw: unknown): TlbVibeEncodings {
  const out: TlbVibeEncodings = {};
  if (raw && typeof raw === 'object') {
    for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
      const enc = val as { encoding?: unknown; infoExtracted?: unknown } | null;
      if (enc && typeof enc.encoding === 'string' && enc.encoding) {
        out[key] = {
          encoding: enc.encoding,
          infoExtracted: typeof enc.infoExtracted === 'number' ? enc.infoExtracted : 1,
        };
      }
    }
  }
  return out;
}

const BAiBAI_IDB_PREFIX = 'idb:';
const BAiBAI_VIBE_DB = 'baibai_image_vibes';
const BAiBAI_VIBE_STORE = 'vibes';

/** 读单条柏宝绘 vibe 正文:服务器 JSON(dataPath)或 idb: 前缀的 IndexedDB。 */
async function loadBaibaiVibeData(dataPath: string, thumbnailPath = ''): Promise<{
  image: string;
  thumbnail: string;
  encodings: TlbVibeEncodings;
} | null> {
  let data: unknown = null;
  if (dataPath.startsWith(BAiBAI_IDB_PREFIX)) {
    data = await readExternalStore(BAiBAI_VIBE_DB, BAiBAI_VIBE_STORE, dataPath.slice(BAiBAI_IDB_PREFIX.length), 1);
  } else {
    const text = await fetchServerText(dataPath);
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
  }
  const d = data as { image?: unknown; thumbnail?: unknown; encodings?: unknown } | null;
  if (!d || typeof d !== 'object') return null;
  const encodings = coerceEncodings(d.encodings);
  if (!Object.keys(encodings).length) return null;
  // 正文缩略图为空时,回落缩略图独立文件(thumbnailPath 为同源服务器路径)
  let thumbnail = str(d.thumbnail);
  if (!thumbnail && thumbnailPath && !thumbnailPath.startsWith(BAiBAI_IDB_PREFIX)) {
    thumbnail = await fetchServerImageDataUrl(thumbnailPath);
  }
  return {
    image: str(d.image),
    thumbnail,
    encodings,
  };
}

export interface BaibaiSyncOptions {
  onProgress?: (stage: string, current: number, total: number) => void;
}

/**
 * 执行同步:NAI 配置整体覆写 + 画师串/预览图/vibe/组 走统一合并管线。
 * 内置官方接入点保持画板自己的 id/url 不被覆盖。画师串柏宝绘 id 与画板互通(名称兜底外再按 id 匹配)。
 */
export async function syncFromBaibai(options: BaibaiSyncOptions = {}): Promise<BaibaiSyncReport> {
  const nai = readBaibaiNai();
  const onProgress = options.onProgress;

  /* ---- NAI 配置覆写 ---- */
  const theirs = Array.isArray(nai.endpoints) ? nai.endpoints : [];
  const mapped: TlbNaiEndpoint[] = [];
  for (const ep of theirs) {
    const url = str(ep.url);
    if (!url) continue;
    // 柏宝绘的官方条跳过 —— 用画板自己的内置官方条(id/展示名都是自己的)
    if (url.replace(/\/+$/, '') === 'https://image.novelai.net') continue;
    mapped.push({ id: newId('ep'), name: str(ep.name, '接入点'), url, key: str(ep.key) });
  }
  settings.nai.endpoints = [officialEndpoint(), ...mapped];
  const endpoints = mapped.length;
  // 活动接入点:按 url 对上柏宝绘当前选的那条;对不上回落官方
  const activeUrl = str(theirs.find(e => e.id === nai.activeEndpointId)?.url).replace(/\/+$/, '');
  const match = settings.nai.endpoints.find(e => e.url.replace(/\/+$/, '') === activeUrl);
  settings.nai.activeEndpointId = match?.id ?? OFFICIAL_ENDPOINT_ID;

  settings.nai.model = str(nai.model, settings.nai.model);
  settings.nai.sampler = str(nai.sampler, settings.nai.sampler);
  settings.nai.steps = num(nai.steps, settings.nai.steps);
  settings.nai.scale = num(nai.scale, settings.nai.scale);
  settings.nai.cfgRescale = num(nai.cfgRescale, settings.nai.cfgRescale);
  settings.nai.noiseSchedule = str(nai.noiseSchedule, settings.nai.noiseSchedule);
  settings.nai.qualityTags = str(nai.qualityTags);
  settings.nai.undesiredContent = str(nai.undesiredContent);
  settings.nai.varietyBoost = bool(nai.varietyBoost);
  settings.nai.portraitSize = str(nai.portraitSize, settings.nai.portraitSize);
  settings.nai.landscapeSize = str(nai.landscapeSize, settings.nai.landscapeSize);
  settings.nai.seed = num(nai.seed, 0);

  /* ---- 画师串(带预览图;id 随柏宝绘原样,合并时 name 优先、id 兜底) ---- */
  const theirsArtists = Array.isArray(nai.artistPresets) ? nai.artistPresets : [];
  const artists: IncomingArtist[] = [];
  for (let i = 0; i < theirsArtists.length; i++) {
    const a = theirsArtists[i];
    const name = str(a.name).trim();
    if (!name) continue;
    const previewPath = str(a.previewPath);
    onProgress?.('预览图', i + 1, theirsArtists.length);
    const preview = previewPath ? await fetchServerImageDataUrl(previewPath) : '';
    artists.push({
      name,
      prompt: str(a.prompt),
      quality: str(a.quality),
      negative: str(a.negative),
      preview,
      sourceId: str(a.id),
      trustSourceId: true, // 柏宝绘 art_/bi_ id 与画板互通,新建时原样沿用
    });
  }

  /* ---- vibe 正文(dataPath 服务器 / idb)+ 按柏宝绘扁平 group 聚合成组 ---- */
  const theirsVibes = Array.isArray(nai.vibes) ? nai.vibes : [];
  const vibes: IncomingVibe[] = [];
  let vibeFail = 0;
  const groupMap = new Map<string, IncomingGroup>();
  for (let i = 0; i < theirsVibes.length; i++) {
    const v = theirsVibes[i];
    const sourceId = str(v.id);
    const dataPath = str(v.dataPath);
    onProgress?.('vibe', i + 1, theirsVibes.length);
    if (!sourceId || !dataPath) {
      vibeFail++;
      continue;
    }
    const data = await loadBaibaiVibeData(dataPath, str(v.thumbnailPath));
    if (!data) {
      vibeFail++;
      continue;
    }
    vibes.push({
      sourceId,
      name: str(v.name, '未命名'),
      image: data.image,
      thumbnail: data.thumbnail,
      encodings: data.encodings,
      strength: clampVibeStrength(v.strength, 0.6),
    });
    const groupName = str(v.group).trim();
    if (groupName) {
      const g = groupMap.get(groupName) ?? { name: groupName, members: [] };
      g.members.push({
        sourceVibeId: sourceId,
        enabled: bool(v.enabled, true),
        strength: clampVibeStrength(v.strength, 0.6),
      });
      groupMap.set(groupName, g);
    }
  }

  const payload: SyncPayload = { artists, vibes, groups: [...groupMap.values()] };
  const report = await applySyncPayload(payload);
  report.vibesFailed += vibeFail;

  // 当前选中:柏宝绘选了库内条目且已同步进来才跟随,否则保持画板现状(含「不使用」)
  const baibaiActive = str(nai.activeArtistId);
  if (baibaiActive && settings.artistPresets.some(x => x.id === baibaiActive)) {
    settings.activeArtistId = baibaiActive;
  }
  settings.lastBaibaiSyncAt = Date.now();
  return { endpoints, ...report };
}
