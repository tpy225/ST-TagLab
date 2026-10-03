/**
 * NAI 常量表 —— 公开知识口径,
 * 质量词/负面词按模型区分。
 */

export const NAI_OFFICIAL_URL = 'https://image.novelai.net';
export const OFFICIAL_ENDPOINT_ID = 'tlb_ep_official';

export const NAI_MODELS: { value: string; label: string }[] = [
  { value: 'nai-diffusion-5-full', label: 'NAI 5 Full(最新,无过滤)' },
  { value: 'nai-diffusion-5-curated', label: 'NAI 5 Curated(有内容过滤)' },
  { value: 'nai-diffusion-4-5-full', label: 'NAI 4.5 Full(无过滤)' },
  { value: 'nai-diffusion-4-5-curated', label: 'NAI 4.5 Curated(有内容过滤)' },
];

export const NAI_SAMPLERS: { value: string; label: string }[] = [
  { value: 'k_euler', label: 'Euler' },
  { value: 'k_euler_ancestral', label: 'Euler Ancestral' },
  { value: 'k_dpmpp_2s_ancestral', label: 'DPM++ 2S Ancestral' },
  { value: 'k_dpmpp_2m', label: 'DPM++ 2M' },
  { value: 'k_dpmpp_2m_sde', label: 'DPM++ 2M SDE' },
  { value: 'k_dpmpp_sde', label: 'DPM++ SDE' },
  { value: 'ddim_v3', label: 'DDIM V3' },
];

const NAI_V5_SAMPLERS = new Set([
  'k_euler_ancestral',
  'k_euler',
  'k_dpmpp_2s_ancestral',
  'k_dpmpp_2m_sde',
  'k_dpmpp_2m',
  'k_dpmpp_sde',
]);

export const NAI_NOISE_SCHEDULES: { value: string; label: string }[] = [
  { value: 'karras', label: 'Karras(推荐)' },
  { value: 'native', label: 'Native' },
  { value: 'exponential', label: 'Exponential' },
  { value: 'polyexponential', label: 'Polyexponential' },
];

/** 各模型官方质量词,拼到正向提示词(位置由「拼接次序」决定)。 */
const QUALITY_TAGS: Record<string, string> = {
  'nai-diffusion-5-full': 'very aesthetic, masterpiece, no text',
  'nai-diffusion-5-curated': 'very aesthetic, masterpiece, no text',
  'nai-diffusion-4-5-full': 'location, very aesthetic, masterpiece, no text',
  'nai-diffusion-4-5-curated': 'location, masterpiece, no text, -0.8::feet::, rating:general',
  'nai-diffusion-4-full': 'no text, best quality, very aesthetic, absurdres',
  'nai-diffusion-4-curated-preview': 'rating:general, best quality, very aesthetic, absurdres',
  'nai-diffusion-3': 'best quality, amazing quality, very aesthetic, absurdres',
};

/** 各模型官方 Heavy 负面词。 */
const DEFAULT_UNDESIRED_CONTENT: Record<string, string> = {
  'nai-diffusion-5-full':
    'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, text, watermark, signature, username, artist name, bad anatomy, bad hands, bad feet, extra digits, fewer digits, extra fingers, fused fingers, extra limbs, missing limbs, long neck, blurry, poorly drawn, unfinished, plastic skin, waxy skin, oversaturated, washed out',
  'nai-diffusion-5-curated':
    'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page',
  'nai-diffusion-3':
    'lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]',
  'nai-diffusion-4-full':
    'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page',
  'nai-diffusion-4-curated-preview':
    'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, white blank page, blank page',
  'nai-diffusion-4-5-curated':
    'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page',
  'nai-diffusion-4-5-full':
    'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page',
};

export function naiDefaultQualityTags(model: string): string {
  return QUALITY_TAGS[model] ?? '';
}

export function naiDefaultUndesired(model: string): string {
  return DEFAULT_UNDESIRED_CONTENT[model] ?? '';
}

export function isNai5(model: string): boolean {
  return model.includes('nai-diffusion-5');
}

function isNai45(model: string): boolean {
  return model.includes('nai-diffusion-4-5');
}

function isNai3(model: string): boolean {
  return model === 'nai-diffusion-3';
}

/** 是否走 v4_prompt 结构(4/4.5/V5 共用;NAI3 不带)。 */
export function naiSupportsV4Prompt(model: string): boolean {
  return !isNai3(model);
}

export function naiSamplers(model: string): { value: string; label: string }[] {
  return isNai5(model) ? NAI_SAMPLERS.filter(s => NAI_V5_SAMPLERS.has(s.value)) : NAI_SAMPLERS;
}

/** variety boost 的 magic 常数:按像素量相对参考分辨率缩放。 */
const REFERENCE_PIXEL_COUNT = 1011712;
const SIGMA_MAGIC_NUMBER = 19;
const SIGMA_MAGIC_NUMBER_V4_5 = 58;

/** skip_cfg_above_sigma:开 variety boost 时按尺寸与模型算;关或 V5 → null。 */
export function skipCfgAboveSigma(width: number, height: number, model: string, varietyBoost: boolean): number | null {
  if (!varietyBoost || isNai5(model)) return null;
  const magic = isNai45(model) ? SIGMA_MAGIC_NUMBER_V4_5 : SIGMA_MAGIC_NUMBER;
  return Math.pow((width * height) / REFERENCE_PIXEL_COUNT, 0.5) * magic;
}

/** 拼端点:base 去尾斜杠后补 /ai/<path>;base 已是完整端点时原样使用。 */
export function naiEndpoint(url: string, path: string): string {
  const base = url.trim().replace(/\/+$/, '');
  if (!base) throw new Error('请先填写 NAI 接口地址');
  const seg = path.replace(/^\/+/, '');
  if (base.endsWith(`/ai/${seg}`) || base.endsWith(`/${seg}`)) return base;
  return `${base}/ai/${seg}`;
}

export interface NaiSize {
  width: number;
  height: number;
}

/** 解析「832×1216 / 832x1216」;宽高须为 64 的倍数、256–2048。 */
export function parseResolution(text: string): NaiSize {
  const match = (text ?? '').match(/(\d{2,4})\s*[×xX*]\s*(\d{2,4})/);
  if (!match) throw new Error(`分辨率格式无效:${text || '(空)'};应如 832×1216`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width % 64 !== 0 || height % 64 !== 0) {
    throw new Error(`分辨率 ${width}×${height} 不是 64 的倍数,NAI 要求宽高均为 64 的倍数`);
  }
  if (width < 256 || height < 256 || width > 2048 || height > 2048) {
    throw new Error(`分辨率 ${width}×${height} 超出 NAI 允许范围(256–2048)`);
  }
  return { width, height };
}

/** NAI 种子是 32 位无符号整数。 */
export function naiRandomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

/** 相邻两次 NAI 请求的最小间隔。 */
export const NAI_MIN_INTERVAL_MS = 1500;

/* ============ Vibe Transfer ============ */

/** 官方 .naiv4vibe 里 encoding 的固定内层 key。 */
export const VIBE_ENCODING_KEY = 'b36a8472fe418d9f80d6bb1c54e3a6e62c62936aa7bf31dae2bcf7e929f6430f';

/** Vibe 文件里合法的模型 key。 */
export const VIBE_MODEL_KEYS = [
  'v5curated',
  'v5full',
  'v4-5curated',
  'v4-5full',
  'v4curated',
  'v4full',
  'v3',
];

/** vibe 编码分组的模型 key(与官方 .naiv4vibe 一致)。 */
export function vibeModelKey(model: string): string {
  if (model.includes('nai-diffusion-5-curated')) return 'v5curated';
  if (model.includes('nai-diffusion-5-full')) return 'v5full';
  if (model.includes('4-5-curated')) return 'v4-5curated';
  if (model.includes('4-5-full')) return 'v4-5full';
  if (model.includes('4-curated')) return 'v4curated';
  if (model.includes('4-full')) return 'v4full';
  if (model.includes('diffusion-3')) return 'v3';
  return 'v4-5full';
}

/**
 * Vibe 本地编码支持的模型 key:
 * 只有 NAI V4 / V4.5 能调 encode-vibe;V5 / V3 / 其他 → null(UI 显示「模型不支持」)。
 * 编码数据本身仍可能含 v5/v3 key(随文件导入)。
 */
export function vibeLocalModelKey(model: string): string | null {
  const name = String(model || '');
  if (name.includes('4-5-curated')) return 'v4-5curated';
  if (name.includes('4-5-full')) return 'v4-5full';
  if (name.includes('4-curated')) return 'v4curated';
  if (name.includes('4-full')) return 'v4full';
  return null;
}

/** vibe 强度钳制到 0–1;非法值回落 default(默认 0.5)。 */
export function clampVibeStrength(value: unknown, fallback = 0.5): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(1, Math.max(0, n));
}

/** 生成 uuid(crypto.randomUUID 可用则用之,否则时间戳回退)。 */
export function randomUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `u_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
