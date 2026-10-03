/**
 * Tag 实验室 · 类型定义
 *
 * 存储分层:
 * - 设置(localStorage 'tlb_settings'):NAI 连接/参数、画师串库、Bot 配置、界面偏好,
 *   全部自管,不进 SillyTavern extension_settings。
 * - 历史(IndexedDB 'st-taglab'):图片 Blob 与元数据(含收藏标记)。
 */

/** 一条画师串配方。 */
export interface TlbArtistPreset {
  id: string;
  /** 显示名;允许重名,以 id 为键。 */
  name: string;
  /** 画师/画风 tag 串,按「拼接次序」设置与提示词拼装;空串 = 不参与拼装。 */
  prompt: string;
  /** 绑定的正面质量词;空串 = 跟随全局覆写 → 模型官方默认。 */
  quality: string;
  /** 绑定的负面提示词;空串 = 跟随全局覆写 → 模型官方默认。 */
  negative: string;
}

/** 快捷输入条目:chip 显示标题(无标题则显示内容),点击插入内容。 */
export interface TlbQuickTag {
  id: string;
  /** chip 短标题;空串 = 直接显示内容。 */
  title: string;
  /** 实际插入正面提示词的 tag 片段。 */
  content: string;
}

/** 单个模型的 vibe 编码(官方 .naiv4vibe 内层)。 */
export interface TlbVibeEncoding {
  /** 编码数据(base64)。 */
  encoding: string;
  /** 信息提取度(编码时提交,生成时不用)。 */
  infoExtracted: number;
}

/** 按模型 key 分组的 vibe 编码(与官方 .naiv4vibe 同构)。 */
export type TlbVibeEncodings = Record<string, TlbVibeEncoding>;

/** 一条 Vibe Transfer 条目(完整正文存 IndexedDB 'vibes' store)。 */
export interface TlbVibe {
  id: string;
  /** 显示名。 */
  name: string;
  /** 参考原图 base64(不含 data: 前缀;编码自图片时有值,供导出)。 */
  image: string;
  /** 缩略图 dataURL(可空,缺省用占位图标)。 */
  thumbnail: string;
  /** 按模型分组的编码数据。 */
  encodings: TlbVibeEncodings;
  /** 信息提取度(0=低·色彩,1=高·构图);烘焙进编码,改了要重新编码。 */
  infoExtracted: number;
  /** 参考强度 0–1。 */
  strength: number;
  /** 生成时是否叠加。 */
  enabled: boolean;
  /** 会话级:是否正在编码(不落盘)。 */
  busy?: boolean;
  createdAt: number;
}

/** 组内成员:只存 vibe id 引用 + 勾选/强度快照。 */
export interface TlbVibeGroupMember {
  id: string;
  enabled: boolean;
  strength: number;
}

/** Vibe 组:勾选+强度的命名快照,选组即整体套用(存 localStorage 设置)。 */
export interface TlbVibeGroup {
  id: string;
  name: string;
  members: TlbVibeGroupMember[];
}

/** 一条 NAI 接入点(官方/镜像/第三方转发),只有地址与密钥。 */
export interface TlbNaiEndpoint {
  id: string;
  name: string;
  url: string;
  key: string;
}

/** 提示词助手的一条已保存系统提示词。 */
export interface TlbBotPrompt {
  id: string;
  name: string;
  content: string;
}

/** 提示词助手的一个配置档(OpenAI 兼容接口,可保存多个)。 */
export interface TlbBotProfile {
  id: string;
  /** 配置档名称。 */
  name: string;
  /** 供应商标识(见 SettingsPanel BOT_PROVIDERS;'custom' = 自定义 OpenAI 兼容)。 */
  provider: string;
  /** 接口基地址,如 https://api.openai.com/v1 或完整 /chat/completions 地址。 */
  baseUrl: string;
  key: string;
  /** 当前使用的模型 id(可手动填写,也可从已拉取列表选)。 */
  model: string;
  /** 已从 /models 拉取到的模型 id 列表。 */
  models: string[];
  /** 当前生效的系统提示词原文(切换已保存条目时同步)。 */
  systemPrompt: string;
  /** 已保存的系统提示词列表。 */
  prompts: TlbBotPrompt[];
  /** 当前选中的系统提示词 id。 */
  activePromptId: string;
}

/** 提示词助手配置(多配置档)。 */
export interface TlbBot {
  profiles: TlbBotProfile[];
  activeProfileId: string;
}

/** 外觀主題:跟隨酒館 或 固定 retro 暖陶米。 */
export type TlbTheme = 'st' | 'retro';

/** NAI 连接与出图参数(画板自管)。 */
export interface TlbNai {
  endpoints: TlbNaiEndpoint[];
  activeEndpointId: string;
  model: string;
  sampler: string;
  steps: number;
  scale: number;
  cfgRescale: number;
  noiseSchedule: string;
  /** 质量词覆写;空串 = 模型官方默认。 */
  qualityTags: string;
  /** 负面词覆写;空串 = 模型官方默认。 */
  undesiredContent: string;
  varietyBoost: boolean;
  portraitSize: string;
  landscapeSize: string;
  /** 面板固定种子;0 = 每次随机。 */
  seed: number;
}

export interface TlbSettings {
  version: number;
  theme: TlbTheme;
  nai: TlbNai;
  bot: TlbBot;
  artistPresets: TlbArtistPreset[];
  /** Vibe 组库(成员只引用 vibe id;vibe 正文在 IndexedDB)。 */
  vibeGroups: TlbVibeGroup[];
  /** 快捷输入条目(生成页 chip 显示标题、点击插入内容)。 */
  quickTags: TlbQuickTag[];
  /** 水印樣式庫。 */
  watermarkPresets: TlbWatermarkPreset[];
  /** 当前画师串 id;空串 = 不使用。 */
  activeArtistId: string;
  /** 拼接次序:画师串是否放在提示词前(默认是)。 */
  artistFirst: boolean;
  /** 拼接次序:质量词是否放在提示词后(默认是)。 */
  qualityLast: boolean;
  /** 浮动面板上次位置(px);null = 默认居中。 */
  panelPos: { x: number; y: number } | null;
  /** 各来源最近一次同步时间戳;0 = 从未同步。 */
  lastBaibaiSyncAt: number;
  lastChatu8SyncAt: number;
  lastXiaobaiSyncAt: number;
  /** 画师库批量对比:每张图之间的随机等待秒数范围(防风控,0–60)。 */
  compareInterval: { minSec: number; maxSec: number };
}

/** 水印配置(全部相對值,跨解析度套用)。 */
export interface TlbWatermarkConfig {
  text: string;
  /** 字級:佔圖片短邊的百分比。 */
  fontPct: number;
  color: string;
  /** 0–1。 */
  opacity: number;
  /** 旋轉角度(平鋪用)。 */
  rotation: number;
  mode: 'tile' | 'single' | 'sticker';
  /** 平鋪間距倍數(相對於文字寬/字高)。 */
  gapMul: number;
  /** 單個/貼紙位置:1–9(由左上列序)。 */
  position: number;
  /** 邊距:佔短邊百分比。 */
  marginPct: number;
  /** 貼紙 PNG 的 data URL(與樣式一起存 localStorage)。 */
  stickerDataUrl?: string;
  /** 貼紙寬度:佔短邊百分比。 */
  stickerSizePct?: number;
}

/** 一條已保存水印樣式。 */
export interface TlbWatermarkPreset {
  id: string;
  name: string;
  config: TlbWatermarkConfig;
}

/** 一条历史记录元数据(IndexedDB 'meta' store;Blob 在 'blobs' store)。 */
export interface TlbHistoryMeta {
  id: string;
  /** 拼装后的完整正向提示词(用于展示/复制)。 */
  prompt: string;
  /** 用户原始输入的正向 tag(不含画师串/质量词;滑动回填用它,避免二次拼装)。 */
  rawPrompt: string;
  negative: string;
  /** 当时生效的画师串原文(空串 = 未使用)。 */
  artistPrompt: string;
  /** 当时选中的画师串预设 id(对比生成等覆写场景为空串;旧记录无此字段)。 */
  artistId?: string;
  /** 当时叠加的 vibe id 列表(回填时勾选;缺失的 id 提示用户)。 */
  vibeIds?: string[];
  /** 当时生效的质量词。 */
  qualityTags: string;
  model: string;
  sampler: string;
  steps: number;
  scale: number;
  cfgRescale: number;
  noiseSchedule: string;
  /** 实际使用的种子(生成后回写,便于复现)。 */
  seed: number;
  width: number;
  height: number;
  mime: string;
  createdAt: number;
  /** 是否收藏;画廊「只看收藏」据此过滤。 */
  favorite: boolean;
  /** 用户自订标签(自由文本;标签库由全部历史自动汇整)。 */
  tags?: string[];
  /** 小缩略图 dataURL(画廊网格用;缺省为空,旧记录回落读全图)。 */
  thumb?: string;
}
