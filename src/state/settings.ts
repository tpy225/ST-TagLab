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

/** 简短版内置提示词(旧默认,保留可切换)。 */
const SHORT_BOT_SYSTEM_PROMPT =
  '你是 Tag 实验室的提示词助手。用户会用自然语言描述想要的画面,你用 NovelAI / Stable Diffusion 的标签(tag)风格回答。要求:只输出英文 tag,用英文逗号分隔;不要写句子、不要解释、不要 Markdown 代码块、不要序号。';

/** 默认详细版提示词。 */
const DEFAULT_BOT_SYSTEM_PROMPT = `你是一名 AI 生图提示词助手。你的任务是把用户的中文或英文自然语言需求,整理成适合 NovelAI 插画生成的英文逗号分隔标签。

【工作原则】

1. 先确定画面核心
- 找出用户最想表现的主体:人物、动作、情绪、物件或场景。
- 保留用户明确指定的事实,不擅自增加人物、道具、剧情或环境细节。
- 用户没有指定的摄影语言,可以为画面表现力适度补全。

2. 选择构图
- 每张图只选一个主要景别,例如 close-up、upper body、full body 或 wide shot。
- 根据表现重点选一个主要视角或构图方式;必要时再加一个焦点或光影标签,不堆砌镜头词。
- 情绪和面部细节适合近景;服装、姿势和角色设定适合全身;环境叙事适合远景。
- 确保景别能容纳用户要求的内容:例如 upper body 不应同时要求鞋子清晰入镜。
- 背面视角、遮挡、闭眼等条件下,不添加看不见的面部、眼睛或身体细节。

3. 编写正向标签
- 正向 Prompt 只使用简短英文标签或必要的简短英文视觉短语,以英文半角逗号和空格分隔;不要写完整的叙事句子。
- 优先使用常见、明确、可见的标签,不自造冗长抽象词组。
- 推荐顺序:画质与媒介 → 人数与主体 → 外貌与表情 → 服装与配饰 → 姿势与动作 → 构图与视角 → 场景与光影 → 风格。
- 同一组相关信息尽量放在一起;排序服从画面重点,不为套用模板而打散主体和动作。
- 不重复近义词,不用大量通用画质词挤占真正重要的视觉信息。
- 对多人画面,明确人数及必要的相对位置;无法用零散标签清楚表达的关系,可以使用简短英文视觉短语。
- 只描述画面中可见的静态瞬间,不同时安排互相冲突的动作或姿势。
- 输出标签总数控制在 40 个以内,最重要的标签放最前。

4. 控制权重
- 默认不加权。只有用户明确强调、且普通排序不足以突出某个要素时,才少量使用 NovelAI 的 {tag} 或 {{tag}}。
- 需要弱化时可使用 [tag];不要使用 WebUI 的 (tag:1.5) 写法。
- 不要机械地给每个标签加权,也不要声称标签排序或加权能保证生成结果。

5. 处理特殊用途
- 角色立绘:优先确保人物完整、服装可见、背景简洁;按需求选择 full body、standing、simple background 等。只有用户要设定展示板时才加入 character sheet。
- Q版贴纸:优先考虑 chibi、简洁轮廓与易抠图背景(white background、simple background);不要依赖 transparent background 标签保证透明效果。
- 剧情 CG:重视人物互动、镜头、环境和光影,但只加入与用户描述相符的场景细节。
- 特定风格:把用户说的风格拆解为可见特征,例如配色、线条、材质或光影;避免堆砌互相冲突的风格词。
- 无人物需求:以物件或环境为主体,不强行加入 1girl、1boy 等人物标签。

6. 输出前检查
- 人数、视角、景别、动作和可见部位是否一致?
- 是否把用户没说过的物件或剧情当成既定事实?
- 是否有重复、矛盾或无助于画面的标签?
- 正向 Prompt 是否可以直接复制使用?

要求:只输出英文 tag,用英文逗号分隔;不要写句子、不要解释、不要 Markdown 代码块、不要序号。`;

export const DEFAULT_BOT_PROFILE_ID = 'bot_default';
export const DEFAULT_BOT_PROMPT_ID = 'bot_prompt_default';
export const SHORT_BOT_PROMPT_ID = 'bot_prompt_short';

export function defaultBotPrompt(over: Partial<TlbBotPrompt> = {}): TlbBotPrompt {
  return { id: DEFAULT_BOT_PROMPT_ID, name: '預設（詳細）', content: DEFAULT_BOT_SYSTEM_PROMPT, ...over };
}

export function shortBotPrompt(over: Partial<TlbBotPrompt> = {}): TlbBotPrompt {
  return { id: SHORT_BOT_PROMPT_ID, name: '預設（簡短）', content: SHORT_BOT_SYSTEM_PROMPT, ...over };
}

export function defaultBotProfile(over: Partial<TlbBotProfile> = {}): TlbBotProfile {
  const prompts = over.prompts?.length ? over.prompts : [defaultBotPrompt(), shortBotPrompt()];
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
    theme: 'retro',
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
    watermarkPresets: [],
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
  // 舊版 day/night 主題已移除,髒值統一回落預設 retro
  if (out.theme !== 'st' && out.theme !== 'retro') out.theme = 'retro';
  out.nai = { ...d.nai, ...(s.nai ?? {}) };
  out.bot = normalizeBot(s.bot as Partial<TlbSettings['bot']> & Record<string, unknown> | undefined);
  if (!Array.isArray(out.nai.endpoints) || out.nai.endpoints.length === 0) {
    out.nai.endpoints = [officialEndpoint()];
  }
  // 官方接入点恒在、url 恒正
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
  out.watermarkPresets = Array.isArray(out.watermarkPresets) ? out.watermarkPresets : [];
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
 * 内置提示词迁移:
 * - 内置两档(详细/简短)内容与名称一律重置为官方版,保证用户随时能切回默认;
 * - 旧版没有简短版 → 补上(保留可切换);
 * - 当前正选中内置档时,systemPrompt 同步为官方内容。自定义条目一律不动。
 */
function migrateBuiltinPrompts(p: TlbBotProfile): TlbBotProfile {
  const builtins: Record<string, () => TlbBotPrompt> = {
    [DEFAULT_BOT_PROMPT_ID]: defaultBotPrompt,
    [SHORT_BOT_PROMPT_ID]: shortBotPrompt,
  };
  for (const [id, factory] of Object.entries(builtins)) {
    const found = p.prompts.find(x => x.id === id);
    if (found) {
      const canonical = factory();
      found.name = canonical.name;
      found.content = canonical.content;
    }
  }
  if (!p.prompts.some(x => x.id === SHORT_BOT_PROMPT_ID)) {
    p.prompts.push(shortBotPrompt());
  }
  if (p.activePromptId === DEFAULT_BOT_PROMPT_ID) p.systemPrompt = DEFAULT_BOT_SYSTEM_PROMPT;
  else if (p.activePromptId === SHORT_BOT_PROMPT_ID) p.systemPrompt = SHORT_BOT_SYSTEM_PROMPT;
  return p;
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
        return migrateBuiltinPrompts(
          defaultBotProfile({
            ...src,
            id,
            name: typeof src.name === 'string' && src.name.trim() ? src.name : `配置 ${i + 1}`,
            provider: typeof src.provider === 'string' && src.provider ? src.provider : 'custom',
            models: Array.isArray(src.models) ? src.models.filter((m): m is string => typeof m === 'string') : [],
            systemPrompt,
            prompts,
            activePromptId: prompts.some(x => x.id === src.activePromptId) ? (src.activePromptId as string) : prompts[0].id,
          }),
        );
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
    const p = migrateBuiltinPrompts(
      defaultBotProfile({
        name: '默认配置',
        baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : defaultBotProfile().baseUrl,
        key: typeof raw.key === 'string' ? raw.key : '',
        model: typeof raw.model === 'string' && raw.model ? raw.model : defaultBotProfile().model,
        systemPrompt,
        prompts: [defaultBotPrompt({ content: systemPrompt })],
        activePromptId: DEFAULT_BOT_PROMPT_ID,
      }),
    );
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
