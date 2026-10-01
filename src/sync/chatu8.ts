/**
 * 从智绘姬(st-chatu8)同步:画师串 + 正负词 + 预览图 + vibe + 组(单向只读,绝不写对方数据)。
 *
 * 数据源 = extension_settings['st-chatu8']:
 * - 画师串:yushe: { [预设名]: { fixedPrompt, fixedPrompt_end, negativePrompt, previewImageId? } },
 *   当前选中 yusheid_novelai(预设名)。
 *   映射:fixedPrompt→画师串 prompt;fixedPrompt_end→正面质量词 quality;negativePrompt→负面词。
 *   智绘姬生成口径是「预设negativePrompt + 官方 UC 基线」一并发出,而画板的 negative 字段是
 *   **完整**负面 caption(直接发给 NovelAI),故同步时按智绘姬自己的 novelaimode + UCP_novelai
 *   复刻其官方 UC 基线烤在用户负向前(见 chatu8Baseline)。用户负向留空则整段留空走回落链。
 * - 预览图:预设只存 previewImageId;图片在 configImageStorage[id].path(服务器,可直接 fetch)
 *   或 IndexedDB「chatu8_config_images / config_images」(记录 {id,data,mimeType...})。
 * - vibe:vibePresets {名:{vibeDataId,strength}} 与 vibeGroups {组名:{vibes:[{vibeDataId,strength}]}},
 *   本体是 .naiv4vibe 文本,同样在 configImageStorage 路径或该 IndexedDB 里。
 */
import { clampVibeStrength, naiDefaultUndesired } from '@/constants';
import { settings } from '@/state/settings';
import {
  applySyncPayload,
  decodeDataUrlText,
  fetchServerImageDataUrl,
  fetchServerText,
  parseNaiv4vibe,
  readExtensionSettings,
  readExternalStore,
  str,
  type IncomingArtist,
  type IncomingGroup,
  type IncomingVibe,
  type SyncPayload,
  type SyncReport,
} from '@/sync/shared';

const CHATU8_KEY = 'st-chatu8';
const CHATU8_DB = 'chatu8_config_images';
const CHATU8_STORE = 'config_images';

export class Chatu8SyncError extends Error {}

interface Chatu8ConfigRecord {
  data?: unknown;
  mimeType?: unknown;
}

/** chatu8 IDB 记录可能再嵌一层 {data:{data,...}}(见其 getConfigFile 解包口径)。 */
function unwrapRecord(rec: Chatu8ConfigRecord | null): Chatu8ConfigRecord | null {
  if (!rec) return null;
  const inner = rec.data;
  if (inner && typeof inner === 'object' && !ArrayBuffer.isView(inner) && 'data' in inner) {
    return inner as Chatu8ConfigRecord;
  }
  return rec;
}

function arrayBufferToBase64(buffer: ArrayBuffer, byteOffset = 0, byteLength?: number): string {
  const bytes = new Uint8Array(buffer, byteOffset, byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/* ───────────────────────── 预览图读取(服务器 → IndexedDB) ───────────────────────── */

/** 把 chatu8 IDB 记录里的图片数据(ArrayBuffer / dataURL / 裸 base64)统一成 dataURL。 */
function recordToDataUrl(recRaw: Chatu8ConfigRecord | null, fallbackMime: string): string {
  const rec = unwrapRecord(recRaw);
  if (!rec) return '';
  const mime = str(rec.mimeType) || str(recRaw?.mimeType) || fallbackMime;
  const raw = rec.data;
  if (typeof raw === 'string') {
    const t = raw.trim();
    return t.startsWith('data:') ? t : `data:${mime};base64,${t}`;
  }
  if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
    if (raw instanceof ArrayBuffer) return `data:${mime};base64,${arrayBufferToBase64(raw)}`;
    const view = raw as ArrayBufferView;
    return `data:${mime};base64,${arrayBufferToBase64(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength)}`;
  }
  return '';
}

/** 按智绘姬的双通道(服务器优先,失败回落 IndexedDB)取预览图 dataURL。 */
async function readChatu8Preview(imageId: string, serverPath?: unknown): Promise<string> {
  const path = typeof serverPath === 'string' ? serverPath : '';
  if (path) {
    const url = await fetchServerImageDataUrl(path);
    if (url) return url;
  }
  const rec = (await readExternalStore(CHATU8_DB, CHATU8_STORE, imageId)) as Chatu8ConfigRecord | null;
  return recordToDataUrl(rec, 'image/png');
}

/* ───────────────────────── vibe 文本读取(服务器 → IndexedDB) ───────────────────────── */

function recordToText(rec: Chatu8ConfigRecord | null): string {
  if (!rec) return '';
  const raw = rec.data;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return '';
    return t.startsWith('data:') ? decodeDataUrlText(t) : t;
  }
  if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
    const buffer = raw instanceof ArrayBuffer ? raw : raw.buffer;
    return new TextDecoder().decode(new Uint8Array(buffer));
  }
  return '';
}

async function readChatu8VibeText(vibeDataId: string, serverPath?: unknown): Promise<string> {
  const path = typeof serverPath === 'string' ? serverPath : '';
  if (path) {
    const text = await fetchServerText(path);
    if (text) return text;
  }
  const rec = (await readExternalStore(CHATU8_DB, CHATU8_STORE, vibeDataId)) as Chatu8ConfigRecord | null;
  let text = recordToText(rec);
  if (text.startsWith('data:')) text = decodeDataUrlText(text);
  return text;
}

/* ───────────────────────── 收集与转换 ───────────────────────── */

interface VibeRef {
  dataId: string;
  strength: number;
  /** 预设名(preset)——用户起的名字最好看;组内条目无名字,用 .naiv4vibe 自带 name。 */
  presetName?: string;
}

interface RawGroup {
  name: string;
  entries: { dataId: string; strength: number }[];
}

/**
 * 复刻智绘姬 getNovelAIQualityPresetsText 的 UC 分支(index.js)。智绘姬生成时
 * 负面 = [预设negativePrompt, 角色UC, 这段官方基线].join(", ")。画板 negative 存的是
 * 完整 caption(直接发给 NovelAI),所以必须把这段基线一起烤进去,否则同步过来的预设
 * 会缺掉官方 UC、出图对不上。用智绘姬自己的 novelaimode + UCP_novelai 判定(而非画板模型默认),
 * 才和用户在智绘姬里选的变体(Heavy/Light/Human Focus/Furry Focus)完全一致。
 * 判定不出时回落画板模型默认 UC,避免同步过来连基线都没有。
 */
function chatu8Baseline(root: Record<string, unknown>): string {
  const mode = str(root.novelaimode);
  const ucp = str(root.UCP_novelai);
  const M = (m: string): boolean => mode === m;
  const U = (v: string): boolean => ucp === v;
  if (M('nai-diffusion-3') && U('Heavy'))
    return 'lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]';
  if (M('nai-diffusion-3') && U('Light'))
    return 'lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing';
  if (M('nai-diffusion-3') && U('Human Focus'))
    return 'lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract], bad anatomy, bad hands, @_@, mismatched pupils, heart-shaped pupils, glowing eyes';
  if (M('nai-diffusion-4-full') && U('Heavy'))
    return 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page';
  if (M('nai-diffusion-4-full') && U('Light'))
    return 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, white blank page, blank page';
  if (M('nai-diffusion-4-curated-preview') && U('Heavy'))
    return 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, white blank page, blank page';
  if (M('nai-diffusion-4-curated-preview') && U('Light'))
    return 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature, white blank page, blank page';
  if (M('nai-diffusion-4-5-curated') && U('Human Focus'))
    return 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page';
  if (M('nai-diffusion-4-5-curated') && U('Heavy'))
    return 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page';
  if (M('nai-diffusion-4-5-curated') && U('Light'))
    return 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page';
  if (M('nai-diffusion-4-5-full') && U('Human Focus'))
    return 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy';
  if (M('nai-diffusion-4-5-full') && U('Heavy'))
    return 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page';
  if (M('nai-diffusion-4-5-full') && U('Light'))
    return 'lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page';
  if (M('nai-diffusion-4-5-full') && U('Furry Focus'))
    return '{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic';
  if (mode.startsWith('nai-diffusion-5') && U('heavy'))
    return 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page';
  if (mode.startsWith('nai-diffusion-5') && U('light'))
    return 'lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::';
  if (mode.startsWith('nai-diffusion-5') && U('humanFocus'))
    return 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy';
  if (mode.startsWith('nai-diffusion-5') && U('furryFocus'))
    return '{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic';
  // 智绘姬里没匹配上(UCP 变体在这模型下不存在等) → 回落画板模型默认 UC
  return naiDefaultUndesired(str(root.novelaimode) || settings.nai.model);
}

function collect(root: Record<string, unknown>) {
  const baseline = chatu8Baseline(root);
  const yushe = (root.yushe && typeof root.yushe === 'object' ? root.yushe : {}) as Record<string, unknown>;
  const storage =
    root.configImageStorage && typeof root.configImageStorage === 'object'
      ? (root.configImageStorage as Record<string, { path?: unknown }>)
      : {};

  const artists: IncomingArtist[] = [];
  for (const [name, value] of Object.entries(yushe)) {
    if (!value || typeof value !== 'object') continue;
    const p = value as Record<string, unknown>;
    const userNeg = str(p.negativePrompt).trim();
    artists.push({
      name,
      prompt: str(p.fixedPrompt).trim(),
      quality: str(p.fixedPrompt_end).trim(),
      negative: userNeg ? [baseline, userNeg].filter(Boolean).join(', ') : '',
      preview: str(p.previewImageId), // 先放 id,下面统一换成 dataURL
    });
  }

  // vibe 数据按 dataId 去重(preset 与 group 可能引用同一个;preset 优先留名字)
  const vibeById = new Map<string, VibeRef>();
  const presets = root.vibePresets && typeof root.vibePresets === 'object'
    ? (root.vibePresets as Record<string, unknown>)
    : {};
  for (const [presetName, value] of Object.entries(presets)) {
    const p = value as Record<string, unknown> | null;
    if (!p || typeof p.vibeDataId !== 'string' || !p.vibeDataId) continue;
    const dataId = p.vibeDataId;
    if (vibeById.has(dataId)) continue;
    vibeById.set(dataId, { dataId, strength: clampVibeStrength(p.strength), presetName });
  }
  const groups: RawGroup[] = [];
  const rawGroups = root.vibeGroups && typeof root.vibeGroups === 'object'
    ? (root.vibeGroups as Record<string, unknown>)
    : {};
  for (const [groupName, value] of Object.entries(rawGroups)) {
    const g = value as { vibes?: unknown } | null;
    if (!g || !Array.isArray(g.vibes)) continue;
    const entries: { dataId: string; strength: number }[] = [];
    for (const item of g.vibes) {
      const v = item as Record<string, unknown> | null;
      if (!v || typeof v.vibeDataId !== 'string' || !v.vibeDataId) continue;
      const dataId = v.vibeDataId;
      const strength = clampVibeStrength(v.strength);
      entries.push({ dataId, strength });
      if (!vibeById.has(dataId)) vibeById.set(dataId, { dataId, strength });
    }
    if (entries.length) groups.push({ name: groupName, entries });
  }

  return { artists, vibeById, groups, storage };
}

export interface Chatu8SyncOptions {
  onProgress?: (stage: string, current: number, total: number) => void;
}

/** 执行智绘姬同步。读不到对方数据时抛 Chatu8SyncError。 */
export async function syncFromChatu8(options: Chatu8SyncOptions = {}): Promise<SyncReport> {
  const root = readExtensionSettings(CHATU8_KEY);
  const onProgress = options.onProgress;
  const { artists, vibeById, groups, storage } = collect(root);
  if (!artists.length && !vibeById.size) {
    throw new Chatu8SyncError('智绘姬里没有可同步的画师串或 vibe');
  }

  /* 预览图:逐条双通道读取 */
  let done = 0;
  for (const a of artists) {
    const imageId = a.preview;
    onProgress?.('预览图', done + 1, artists.length);
    a.preview = imageId ? await readChatu8Preview(imageId, storage[imageId]?.path) : '';
    done++;
  }

  /* vibe 正文:逐条取回 .naiv4vibe 文本并解析;单个失败不阻塞 */
  const vibes: IncomingVibe[] = [];
  let vibeFail = 0;
  let vi = 0;
  for (const ref of vibeById.values()) {
    onProgress?.('vibe', vi + 1, vibeById.size);
    vi++;
    const text = await readChatu8VibeText(ref.dataId, storage[ref.dataId]?.path);
    if (!text) {
      vibeFail++;
      continue;
    }
    try {
      const parsed = parseNaiv4vibe(text);
      vibes.push({
        sourceId: ref.dataId,
        name: ref.presetName ?? parsed.name,
        image: parsed.image,
        thumbnail: parsed.thumbnail,
        encodings: parsed.encodings,
        strength: Number.isFinite(ref.strength) ? ref.strength : parsed.strength,
      });
    } catch {
      vibeFail++;
    }
  }

  /* 组:组内 dataId → 成员(默认勾选)。只有成功取回的 vibe 才进得来。 */
  const incomingGroups: IncomingGroup[] = groups.map(g => ({
    name: g.name,
    members: g.entries.map(e => ({ sourceVibeId: e.dataId, enabled: true, strength: e.strength })),
  }));

  const payload: SyncPayload = { artists, vibes, groups: incomingGroups };
  const report = await applySyncPayload(payload);
  report.vibesFailed += vibeFail;
  settings.lastChatu8SyncAt = Date.now();
  return report;
}
