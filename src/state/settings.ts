/**
 * 设置存储:localStorage 自管的响应式单例。
 *
 * 与柏宝绘的分工:这里的数据**只**属于画板 —— 柏宝绘不知道它,它也不写
 * extension_settings(同步是单向读)。启动时 hydrate 一次,之后任意字段变更
 * 即时落盘(浅 watch + JSON 全量序列化,量级小到不值得做增量)。
 */
import { reactive, watch } from 'vue';

import { NAI_OFFICIAL_URL, OFFICIAL_ENDPOINT_ID, naiDefaultQualityTags, naiDefaultUndesired } from '@/constants';
import { removeArtistPreview } from '@/state/artistPreviews';
import { artistDraft } from '@/state/ui';
import type { TlbArtistPreset, TlbBotProfile, TlbBotPrompt, TlbNaiEndpoint, TlbQuickTag, TlbSettings } from '@/types';

const STORAGE_KEY = 'tlb_settings';

/** 快捷输入内置条目(标题留空时 chip 直接显示内容)。 */
export const DEFAULT_QUICK_TAGS: TlbQuickTag[] = [
  { id: 'qt_builtin_quality', title: '质量', content: 'masterpiece, best quality, amazing quality' },
  { id: 'qt_builtin_girl', title: '女孩', content: '1girl' },
  { id: 'qt_builtin_boy', title: '男孩', content: '1boy' },
  { id: 'qt_builtin_solo', title: '单人', content: 'solo' },
  { id: 'qt_builtin_cowboy', title: '牛仔景', content: 'cowboy shot' },
  { id: 'qt_builtin_closeup', title: '特写', content: 'close-up' },
  { id: 'qt_builtin_fullbody', title: '全身', content: 'full body' },
  { id: 'qt_builtin_artist', title: '', content: 'artist:' },
];

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function officialEndpoint(): TlbNaiEndpoint {
  return { id: OFFICIAL_ENDPOINT_ID, name: 'NovelAI 官方', url: NAI_OFFICIAL_URL, key: '' };
}

const DEFAULT_BOT_SYSTEM_PROMPT =
  '你是 Tag 实验室的提示词助手。用户会用自然语言描述想要的画面,你用 NovelAI / Stable Diffusion 的标签(tag)风格回答。要求:只输出英文 tag,用英文逗号分隔;不要写句子、不要解释、不要 Markdown 代码块、不要序号。';

export const DEFAULT_BOT_PROFILE_ID = 'bot_default';
export const DEFAULT_BOT_PROMPT_ID = 'bot_prompt_default';

export function defaultBotPrompt(over: Partial<TlbBotPrompt> = {}): TlbBotPrompt {
  return { id: DEFAULT_BOT_PROMPT_ID, name: '默认提示词', content: DEFAULT_BOT_SYSTEM_PROMPT, ...over };
}

export function defaultBotProfile(over: Partial<TlbBotProfile> = {}): TlbBotProfile {
  const prompts = over.prompts?.length ? over.prompts : [defaultBotPrompt()];
  return {
    id: DEFAULT_BOT_PROFILE_ID,
    name: '默认配置',
    provider: 'custom',
    baseUrl: 'https://api.openai.com/v1',
    key: '',
    model: 'gpt-4o-mini',
    models: [],
    systemPrompt: DEFAULT_BOT_SYSTEM_PROMPT,
    prompts,
    activePromptId: over.activePromptId && prompts.some(p => p.id === over.activePromptId)
      ? over.activePromptId
      : prompts[0].id,
    ...over,
  };
}

export function defaultSettings(): TlbSettings {
  return {
    version: 1,
    theme: 'st',
    nai: {
      endpoints: [officialEndpoint()],
      activeEndpointId: OFFICIAL_ENDPOINT_ID,
      model: 'nai-diffusion-4-5-full',
      sampler: 'k_euler_ancestral',
      steps: 23,
      scale: 5,
      cfgRescale: 0,
      noiseSchedule: 'karras',
      qualityTags: '',
      undesiredContent: '',
      varietyBoost: false,
      portraitSize: '832×1216',
      landscapeSize: '1216×832',
      seed: 0,
    },
    artistPresets: [],
    vibeGroups: [],
    quickTags: [...DEFAULT_QUICK_TAGS],
    activeArtistId: '',
    artistFirst: true,
    qualityLast: true,
    panelPos: null,
    lastBaibaiSyncAt: 0,
    lastChatu8SyncAt: 0,
    lastXiaobaiSyncAt: 0,
    compareInterval: { minSec: 10, maxSec: 30 },
    bot: {
      profiles: [defaultBotProfile()],
      activeProfileId: DEFAULT_BOT_PROFILE_ID,
    },
  };
}

/** 归一:补缺失字段、纠脏值(手工改 localStorage / 版本升级的兜底)。 */
function normalize(s: TlbSettings): TlbSettings {
  const d = defaultSettings();
  const out: TlbSettings = { ...d, ...s };
  out.nai = { ...d.nai, ...(s.nai ?? {}) };
  out.bot = normalizeBot(s.bot as Partial<TlbSettings['bot']> & Record<string, unknown> | undefined);
  if (!Array.isArray(out.nai.endpoints) || out.nai.endpoints.length === 0) {
    out.nai.endpoints = [officialEndpoint()];
  }
  // 官方接入点恒在、url 恒正(与柏宝绘同口径)
  if (!out.nai.endpoints.some(e => e.id === OFFICIAL_ENDPOINT_ID)) {
    out.nai.endpoints.unshift(officialEndpoint());
  } else {
    const off = out.nai.endpoints.find(e => e.id === OFFICIAL_ENDPOINT_ID)!;
    off.url = NAI_OFFICIAL_URL;
  }
  if (!out.nai.endpoints.some(e => e.id === out.nai.activeEndpointId)) {
    out.nai.activeEndpointId = out.nai.endpoints[0].id;
  }
  if (!NAI_MODELS_OK.has(out.nai.model)) out.nai.model = d.nai.model;
  if (!out.artistPresets) out.artistPresets = [];
  if (!Array.isArray(out.vibeGroups)) out.vibeGroups = [];
  if (!out.artistPresets.some(a => a.id === out.activeArtistId)) out.activeArtistId = '';
  out.quickTags = normalizeQuickTags(s.quickTags as unknown);
  out.compareInterval = normalizeCompareInterval(s.compareInterval as unknown);
  return out;
}

/** 对比间隔归一:整数秒 0–60,min>max 自动交换;非法值回落 10–30。 */
function normalizeCompareInterval(raw: unknown): { minSec: number; maxSec: number } {
  const o = raw && typeof raw === 'object' ? (raw as { minSec?: unknown; maxSec?: unknown }) : {};
  const clamp = (v: unknown, fb: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(60, Math.max(0, Math.round(v))) : fb;
  let minSec = clamp(o.minSec, 10);
  let maxSec = clamp(o.maxSec, 30);
  if (minSec > maxSec) [minSec, maxSec] = [maxSec, minSec];
  return { minSec, maxSec };
}

/**
 * Bot 配置归一:
 * - 旧版(单条 baseUrl/key/model/systemPrompt)迁移成一个配置档;
 * - 新版补字段、保证至少一档且 activeId 有效。
 */
function normalizeBot(raw: (Partial<TlbSettings['bot']> & Record<string, unknown>) | undefined): TlbSettings['bot'] {
  if (raw && Array.isArray(raw.profiles)) {
    const profiles = (raw.profiles as unknown[])
      .map((p, i) => {
        if (!p || typeof p !== 'object') return null;
        const src = p as Partial<TlbBotProfile> & Record<string, unknown>;
        const id = typeof src.id === 'string' && src.id ? src.id : newId('bot');
        const systemPrompt = typeof src.systemPrompt === 'string' && src.systemPrompt
          ? src.systemPrompt
          : DEFAULT_BOT_SYSTEM_PROMPT;
        const prompts = normalizeBotPrompts(src.prompts, systemPrompt);
        return defaultBotProfile({
          ...src,
          id,
          name: typeof src.name === 'string' && src.name.trim() ? src.name : `配置 ${i + 1}`,
          provider: typeof src.provider === 'string' && src.provider ? src.provider : 'custom',
          models: Array.isArray(src.models) ? src.models.filter((m): m is string => typeof m === 'string') : [],
          systemPrompt,
          prompts,
          activePromptId: prompts.some(x => x.id === src.activePromptId) ? (src.activePromptId as string) : prompts[0].id,
        });
      })
      .filter((p): p is TlbBotProfile => p !== null);
    if (profiles.length) {
      const activeProfileId = profiles.some(p => p.id === raw.activeProfileId)
        ? (raw.activeProfileId as string)
        : profiles[0].id;
      return { profiles, activeProfileId };
    }
  } else if (raw && (typeof raw.baseUrl === 'string' || typeof raw.key === 'string')) {
    // 旧版单条配置迁移
    const systemPrompt = typeof raw.systemPrompt === 'string' && raw.systemPrompt
      ? raw.systemPrompt
      : DEFAULT_BOT_SYSTEM_PROMPT;
    const p = defaultBotProfile({
      name: '默认配置',
      baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : defaultBotProfile().baseUrl,
      key: typeof raw.key === 'string' ? raw.key : '',
      model: typeof raw.model === 'string' && raw.model ? raw.model : defaultBotProfile().model,
      systemPrompt,
      prompts: [defaultBotPrompt({ content: systemPrompt })],
      activePromptId: DEFAULT_BOT_PROMPT_ID,
    });
    return { profiles: [p], activeProfileId: p.id };
  }
  return { profiles: [defaultBotProfile()], activeProfileId: DEFAULT_BOT_PROFILE_ID };
}

/** 系统提示词列表归一:非法/空列表时用当前 systemPrompt 兜底成一条;选中 id 无效回落第一条。 */
function normalizeBotPrompts(raw: unknown, fallbackContent: string): TlbBotPrompt[] {
  if (Array.isArray(raw)) {
    const list = raw
      .map((p, i) => {
        if (!p || typeof p !== 'object') return null;
        const src = p as Partial<TlbBotPrompt>;
        const content = typeof src.content === 'string' ? src.content : '';
        if (!content.trim()) return null;
        return {
          id: typeof src.id === 'string' && src.id ? src.id : newId('bp'),
          name: typeof src.name === 'string' && src.name.trim() ? src.name : `提示词 ${i + 1}`,
          content,
        };
      })
      .filter((p): p is TlbBotPrompt => p !== null);
    if (list.length) return list;
  }
  return [defaultBotPrompt({ content: fallbackContent })];
}

/**
 * 快捷输入归一:兼容旧版字符串数组(迁移为 { title:'', content }),
 * 丢弃内容为空 / 形状非法的条目;id 缺失补生成。
 */
function normalizeQuickTags(raw: unknown): TlbQuickTag[] {
  if (!Array.isArray(raw)) return DEFAULT_QUICK_TAGS.map(q => ({ ...q }));
  const stamp = Date.now().toString(36);
  const out: TlbQuickTag[] = [];
  raw.forEach((q, i) => {
    if (typeof q === 'string') {
      const content = q.trim();
      if (content) out.push({ id: `qt_mig_${stamp}_${i}`, title: '', content });
    } else if (q && typeof q === 'object') {
      const content = typeof (q as { content?: unknown }).content === 'string'
        ? ((q as { content: string }).content).trim()
        : '';
      if (!content) return;
      const title = typeof (q as { title?: unknown }).title === 'string' ? (q as { title: string }).title : '';
      const id = typeof (q as { id?: unknown }).id === 'string' && (q as { id: string }).id
        ? (q as { id: string }).id
        : `qt_${stamp}_${i}`;
      out.push({ id, title, content });
    }
  });
  return out;
}

const NAI_MODELS_OK = new Set([
  'nai-diffusion-5-full',
  'nai-diffusion-5-curated',
  'nai-diffusion-4-5-full',
  'nai-diffusion-4-5-curated',
]);

function load(): TlbSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings();
    return normalize({ ...defaultSettings(), ...(JSON.parse(raw) as Partial<TlbSettings>) });
  } catch (e) {
    console.warn('[TagLab] 设置读取失败,使用默认值', e);
    return defaultSettings();
  }
}

/** 全局响应式设置单例(全插件共用这一份)。 */
export const settings = reactive<TlbSettings>(load());

let saveTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  settings,
  () => {
    // 防抖落盘:滑块拖动时会高频触发
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch (e) {
        console.error('[TagLab] 设置保存失败', e);
      }
    }, 150);
  },
  { deep: true },
);

/** 当前生效的接入点(恒非空:normalize 兜底回落第一条)。 */
export function activeEndpoint(): TlbNaiEndpoint {
  return settings.nai.endpoints.find(e => e.id === settings.nai.activeEndpointId) ?? settings.nai.endpoints[0];
}

/** 当前生效的提示词助手配置档(恒非空:normalize 兜底)。 */
export function activeBotProfile(): TlbBotProfile {
  return settings.bot.profiles.find(p => p.id === settings.bot.activeProfileId) ?? settings.bot.profiles[0];
}

/** 当前选中的画师串;未选/悬空 → null。 */
export function activeArtistPreset() {
  if (!settings.activeArtistId) return null;
  return settings.artistPresets.find(a => a.id === settings.activeArtistId) ?? null;
}

/** 质量词三级回落:配方绑定 → 全局覆写 → 模型官方默认。 */
export function resolveQualityTags(): string {
  return activeArtistPreset()?.quality.trim() || settings.nai.qualityTags.trim() || naiDefaultQualityTags(settings.nai.model);
}

/** 负面词三级回落:配方绑定 → 全局覆写 → 模型官方默认。 */
export function resolveUndesired(): string {
  return activeArtistPreset()?.negative.trim() || settings.nai.undesiredContent.trim() || naiDefaultUndesired(settings.nai.model);
}

/** 当前生效画师串原文(未选/全空白 → 空串)。
 * 未选预设时回落到 artistDraft(回填旧图时画师串预设已不存在的临时内容,会话级)。 */
export function activeArtistPrompt(): string {
  return activeArtistPreset()?.prompt.trim() ?? artistDraft.text.trim();
}

/** 手动从下拉选画师串(含「不使用」):选择即清掉临时画师串草稿。回填不走这里。 */
export function selectArtist(id: string): void {
  settings.activeArtistId = id;
  artistDraft.text = '';
}

/** 全局质量词(忽略画师串绑定):覆写 → 模型官方默认。多画师串对比用它。 */
export function globalQualityTags(): string {
  return settings.nai.qualityTags.trim() || naiDefaultQualityTags(settings.nai.model);
}

/** 全局负面词(忽略画师串绑定):覆写 → 模型官方默认。多画师串对比用它。 */
export function globalUndesired(): string {
  return settings.nai.undesiredContent.trim() || naiDefaultUndesired(settings.nai.model);
}

/** 画师串库的增删改(P0 直接操作 settings,保存自动落盘)。 */
export const artistStore = {
  add(preset?: Partial<TlbArtistPreset>): TlbArtistPreset {
    const item: TlbArtistPreset = {
      id: newId('art'),
      name: preset?.name ?? '新画师串',
      prompt: preset?.prompt ?? '',
      quality: preset?.quality ?? '',
      negative: preset?.negative ?? '',
    };
    settings.artistPresets.push(item);
    return item;
  },
  duplicate(id: string): TlbArtistPreset | null {
    const src = settings.artistPresets.find(a => a.id === id);
    if (!src) return null;
    const copy: TlbArtistPreset = { ...src, id: newId('art'), name: `${src.name} 副本` };
    settings.artistPresets.push(copy);
    return copy;
  },
  remove(id: string): void {
    const idx = settings.artistPresets.findIndex(a => a.id === id);
    if (idx >= 0) settings.artistPresets.splice(idx, 1);
    if (settings.activeArtistId === id) settings.activeArtistId = '';
    void removeArtistPreview(id);
  },
};
