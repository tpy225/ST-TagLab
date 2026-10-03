<script setup lang="ts">
/**
 * 设置页(全部为默认收起的折叠卡):NAI配置 / 提示词助手 / 柏宝绘同步 / 快捷输入 / 资料管理(含导入导出)。
 * 所有改动即时落盘(state/settings.ts 的 watch 负责),无「保存」按钮。
 */
import { computed, onUnmounted, reactive, ref, watch } from 'vue';

import { OFFICIAL_ENDPOINT_ID } from '@/constants';
import { testConnection } from '@/nai/client';
import { listModels } from '@/nai/bot';
import { DEFAULT_BOT_PROMPT_ID, SHORT_BOT_PROMPT_ID, newId, settings } from '@/state/settings';
import { history, wipeHistory } from '@/state/historyList';
import { loadVibes, vibeList, wipeVibes } from '@/state/vibeList';
import { artistPreviews, setArtistPreview } from '@/state/artistPreviews';
import { saveVibe } from '@/storage/vibes';
import { clearImageUrlCache } from '@/state/ui';
import { notify } from '@/st/toast';
import { syncFromBaibai, type BaibaiSyncReport } from '@/sync/baibai';
import { syncFromChatu8 } from '@/sync/chatu8';
import { syncFromXiaobai } from '@/sync/xiaobaix';
import type { SyncReport } from '@/sync/shared';
import Icon from '@/components/Icon.vue';
import TlbSelect from '@/components/TlbSelect.vue';
import type { TlbArtistPreset, TlbBotProfile, TlbNaiEndpoint, TlbVibe } from '@/types';

/* ---- 三向同步(柏宝绘 / 智绘姬 / 小白X)---- */
type SyncSource = 'baibai' | 'chatu8' | 'xiaobaix';

const syncState = reactive<Record<SyncSource, { busy: boolean; status: string }>>({
  baibai: { busy: false, status: '' },
  chatu8: { busy: false, status: '' },
  xiaobaix: { busy: false, status: '' },
});

const anySyncing = computed(() => Object.values(syncState).some(s => s.busy));

function syncTime(ts: number): string {
  if (!ts) return '从未同步';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STAGE_LABELS: Record<string, string> = {
  预览图: '读取预览图',
  vibe: '读取 vibe',
  合并: '合并入库',
};

function formatSyncReport(r: SyncReport, endpoints?: number): string {
  const parts: string[] = [];
  if (typeof endpoints === 'number') parts.push(`接入点 ${endpoints} 条`);
  parts.push(`画师串 新增 ${r.artistsImported}·覆盖 ${r.artistsUpdated}·相同 ${r.artistsSkipped}`);
  if (r.previewsAdded || r.previewsUpdated) {
    parts.push(`预览图 新增 ${r.previewsAdded}·更新 ${r.previewsUpdated}`);
  }
  parts.push(
    `vibe 新增 ${r.vibesImported}·补全 ${r.vibesUpdated}·相同 ${r.vibesSkipped}`
      + (r.vibesFailed ? `·取不到 ${r.vibesFailed}` : ''),
  );
  if (r.groupsAdded || r.groupsUpdated) parts.push(`vibe 组 新增 ${r.groupsAdded}·更新 ${r.groupsUpdated}`);
  return parts.join(';');
}

async function runSync(source: SyncSource): Promise<void> {
  const state = syncState[source];
  state.busy = true;
  state.status = '准备…';
  const onProgress = (stage: string, current: number, total: number): void => {
    const label = STAGE_LABELS[stage] ?? stage;
    state.status = total > 1 ? `${label} ${current}/${total}` : label;
  };
  try {
    let report: SyncReport;
    let endpoints: number | undefined;
    if (source === 'baibai') {
      const r: BaibaiSyncReport = await syncFromBaibai({ onProgress });
      report = r;
      endpoints = r.endpoints;
    } else if (source === 'chatu8') {
      report = await syncFromChatu8({ onProgress });
    } else {
      report = await syncFromXiaobai({ onProgress });
    }
    notify('success', `同步完成:${formatSyncReport(report, endpoints)}`);
  } catch (e) {
    notify('error', e instanceof Error ? e.message : String(e));
  } finally {
    state.busy = false;
    state.status = '';
  }
}

/* ---- NAI 接入点(与生成页画师串预设同一套:下拉载入 → 草稿编辑 → 💾写回/＋另存/rename/🗑) ---- */
const showKey = ref(false);
const testing = ref(false);

/** 各分区折叠状态:NAI 配置默认展开,其余默认收起。 */
const open = reactive<Record<string, boolean>>({
  nai: true,
  bot: false,
  sync: false,
  quick: false,
  data: false,
});

function isOfficial(id: string): boolean {
  return id === OFFICIAL_ENDPOINT_ID;
}

/** 当前选中的接入点(数据异常时回落第一条)。 */
const activeEp = computed<TlbNaiEndpoint>(
  () => settings.nai.endpoints.find(e => e.id === settings.nai.activeEndpointId) ?? settings.nai.endpoints[0],
);

const activeIsOfficial = computed(() => isOfficial(activeEp.value.id));

/** 接口地址/Key 草稿:切换下拉载入,只有 💾 才写回当前接入点。 */
const epDraft = reactive({ url: '', key: '' });

function loadEpDraft(): void {
  epDraft.url = activeEp.value.url;
  epDraft.key = activeEp.value.key;
}
loadEpDraft();
watch(() => settings.nai.activeEndpointId, loadEpDraft);

/** 💾:把草稿写回当前接入点(官方只写 Key,地址固定)。 */
function saveEndpoint(): void {
  const ep = activeEp.value;
  if (!isOfficial(ep.id)) ep.url = epDraft.url.trim();
  ep.key = epDraft.key;
  notify('success', `接入点「${ep.name}」已保存`);
}

/** ＋:用当前草稿另存为新接入点,弹窗命名。 */
function saveEndpointAs(): void {
  const cur = activeEp.value;
  const input = window.prompt('另存为新接入点,输入名称:', isOfficial(cur.id) ? '新接入点' : `${cur.name} 副本`);
  if (input === null) return;
  const name = input.trim();
  if (!name) {
    notify('warning', '名称不能为空');
    return;
  }
  const ep: TlbNaiEndpoint = {
    id: newId('ep'),
    name,
    url: isOfficial(cur.id) ? epDraft.url : epDraft.url.trim(),
    key: epDraft.key,
  };
  settings.nai.endpoints.push(ep);
  settings.nai.activeEndpointId = ep.id;
  notify('success', `已另存为「${name}」`);
}

/** rename:重命名当前接入点(官方名固定)。 */
function renameEndpoint(): void {
  const ep = activeEp.value;
  if (isOfficial(ep.id)) return;
  const input = window.prompt('重新命名接入点:', ep.name);
  if (input === null) return;
  const name = input.trim();
  if (!name) {
    notify('warning', '名称不能为空');
    return;
  }
  ep.name = name;
}

/** 🗑:删除当前接入点(官方不可删)。 */
function removeEndpoint(): void {
  const ep = activeEp.value;
  if (isOfficial(ep.id)) return;
  if (!window.confirm(`删除接入点「${ep.name}」?`)) return;
  const idx = settings.nai.endpoints.findIndex(e => e.id === ep.id);
  if (idx >= 0) settings.nai.endpoints.splice(idx, 1);
  settings.nai.activeEndpointId = settings.nai.endpoints[0].id;
}

async function test(): Promise<void> {
  testing.value = true;
  try {
    // 测的是表单里当前的地址/Key(草稿),未保存也能先验证
    const msg = await testConnection({ url: epDraft.url, key: epDraft.key });
    notify('success', msg);
  } catch (e) {
    notify('error', e instanceof Error ? e.message : String(e));
  } finally {
    testing.value = false;
  }
}

/* ---- 提示词助手:多配置档 ---- */
const showBotKey = ref(false);
const botLoading = ref(false);
/** Model 自定义下拉是否展开(input 仍可手填 id)。 */
const botModelOpen = ref(false);

/** Provider 常用官方渠道(国内品牌优先);url 为空 = 自定义,不代填。 */
const BOT_PROVIDERS = [
  { id: 'custom', name: 'OpenAI 兼容(自定义)', url: '', model: '' },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'zhipu', name: '智谱 GLM', url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { id: 'moonshot', name: '月之暗面 Kimi', url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { id: 'dashscope', name: '阿里通义千问', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo' },
  { id: 'doubao', name: '字节豆包(火山方舟)', url: 'https://ark.cn-beijing.volces.com/api/v3', model: '' },
  { id: 'openai', name: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
] as const;

/** 当前选中的配置档(数据异常时回落第一条)。 */
const activeBot = computed<TlbBotProfile>(
  () => settings.bot.profiles.find(p => p.id === settings.bot.activeProfileId) ?? settings.bot.profiles[0],
);

/** 只剩最后一档时不允许删除。 */
const botLastOne = computed(() => settings.bot.profiles.length <= 1);

/**
 * 表单草稿:与生成页画师串预设同一套——下拉把配置载入草稿,
 * 只有点 💾 才写回当前档;＋ 是把当前表单另存为新档。切换/删除不自动保存。
 */
const botDraft = reactive({ provider: 'custom', baseUrl: '', key: '', model: '' });
/** 系统提示词正文草稿(提示词库的载入/保存也围绕它)。 */
const botPromptText = ref('');

function loadBotDraft(): void {
  const p = activeBot.value;
  botDraft.provider = p.provider;
  botDraft.baseUrl = p.baseUrl;
  botDraft.key = p.key;
  botDraft.model = p.model;
  botPromptText.value = p.systemPrompt;
}
loadBotDraft();
watch(() => settings.bot.activeProfileId, loadBotDraft);

/** 💾:把当前表单(含正文)写回当前配置档。 */
function saveBotProfile(): void {
  const p = activeBot.value;
  p.provider = botDraft.provider;
  p.baseUrl = botDraft.baseUrl.trim();
  p.key = botDraft.key;
  p.model = botDraft.model.trim();
  p.systemPrompt = botPromptText.value;
  notify('success', `配置档「${p.name}」已保存`);
}

/** ＋:用当前表单内容另存为新配置档,弹窗命名。 */
function saveBotProfileAs(): void {
  const cur = activeBot.value;
  const input = window.prompt('另存为新配置档,输入名称:', `${cur.name} 副本`);
  if (input === null) return;
  const name = input.trim();
  if (!name) {
    notify('warning', '名称不能为空');
    return;
  }
  const p: TlbBotProfile = {
    id: newId('bot'),
    name,
    provider: botDraft.provider,
    baseUrl: botDraft.baseUrl.trim(),
    key: botDraft.key,
    model: botDraft.model.trim(),
    models: [...cur.models],
    systemPrompt: botPromptText.value,
    prompts: cur.prompts.map(x => ({ ...x })),
    activePromptId: cur.activePromptId,
  };
  settings.bot.profiles.push(p);
  settings.bot.activeProfileId = p.id;
  notify('success', `已另存为「${name}」`);
}

/** rename:重命名当前配置档。 */
function renameBotProfile(): void {
  const p = activeBot.value;
  const input = window.prompt('重新命名配置档:', p.name);
  if (input === null) return;
  const name = input.trim();
  if (!name) {
    notify('warning', '名称不能为空');
    return;
  }
  p.name = name;
}

/** 🗑:删除当前配置档(至少保留一档)。 */
function removeBotProfile(): void {
  if (botLastOne.value) return;
  const p = activeBot.value;
  if (!window.confirm(`删除配置档「${p.name}」?`)) return;
  const idx = settings.bot.profiles.findIndex(x => x.id === p.id);
  if (idx >= 0) settings.bot.profiles.splice(idx, 1);
  settings.bot.activeProfileId = settings.bot.profiles[0].id;
}

/** 切换 Provider:选定官方渠道时代填 Base URL,模型为空时顺带填推荐模型。 */
function onProviderChange(id: string | number): void {
  const prov = BOT_PROVIDERS.find(x => x.id === String(id)) ?? BOT_PROVIDERS[0];
  botDraft.provider = prov.id;
  if (prov.url) botDraft.baseUrl = prov.url;
  if (prov.model && !botDraft.model.trim()) botDraft.model = prov.model;
}

/** 从下拉选某个模型:写入草稿并收起(input 本身仍可手动改)。 */
function pickBotModel(m: string): void {
  botDraft.model = m;
  botModelOpen.value = false;
}

/** 拉取模型列表:用表单草稿里的地址/Key 请求,结果存进当前档、Model 草稿留空时自动填。 */
async function fetchBotModels(): Promise<void> {
  botLoading.value = true;
  try {
    const ids = await listModels({ baseUrl: botDraft.baseUrl, key: botDraft.key });
    activeBot.value.models = ids;
    if (!botDraft.model.trim() && ids.length) botDraft.model = ids[0];
    botModelOpen.value = true;
    notify('success', `拉到 ${ids.length} 个模型,已展开可选`);
  } catch (e) {
    notify('error', e instanceof Error ? e.message : String(e));
  } finally {
    botLoading.value = false;
  }
}

/* ---- 系统提示词库(每档可存多条;操作围绕正文草稿 botPromptText) ---- */
const botPromptLastOne = computed(() => activeBot.value.prompts.length <= 1);

/** 内置默认提示词:只读,保证用户随时可切回;要改请用「＋另存」复制成自己的。 */
const BOT_PROMPT_BUILTIN_IDS = new Set([DEFAULT_BOT_PROMPT_ID, SHORT_BOT_PROMPT_ID]);
const activeBotPromptBuiltin = computed(() =>
  BOT_PROMPT_BUILTIN_IDS.has(activeBot.value.activePromptId),
);

/** 切换已保存提示词:把内容载入正文草稿。 */
function pickBotPrompt(id: string | number): void {
  const p = activeBot.value;
  const found = p.prompts.find(x => x.id === String(id));
  if (!found) return;
  p.activePromptId = found.id;
  botPromptText.value = found.content;
}

/** 💾:把正文当前内容写回选中的提示词条目(内置默认只读)。 */
function saveBotPrompt(): void {
  const p = activeBot.value;
  if (activeBotPromptBuiltin.value) {
    notify('warning', '内置默认提示词不可修改,点「＋」另存为自己的提示词');
    return;
  }
  const found = p.prompts.find(x => x.id === p.activePromptId);
  if (!found) return;
  if (!botPromptText.value.trim()) {
    notify('warning', '提示词内容是空的,没有可保存的内容');
    return;
  }
  found.content = botPromptText.value;
  p.systemPrompt = botPromptText.value;
  notify('success', `已保存到「${found.name}」`);
}

/** ＋:用正文当前内容另存为新提示词,弹窗命名。 */
function saveBotPromptAs(): void {
  const p = activeBot.value;
  const input = window.prompt('另存为新提示词,输入名称:', `提示词 ${p.prompts.length + 1}`);
  if (input === null) return;
  const name = input.trim();
  if (!name) {
    notify('warning', '名称不能为空');
    return;
  }
  const item = { id: newId('bp'), name, content: botPromptText.value };
  p.prompts.push(item);
  p.activePromptId = item.id;
  p.systemPrompt = botPromptText.value;
  notify('success', `已另存为「${name}」`);
}

/** rename:重命名选中的提示词(内置默认不可改名)。 */
function renameBotPrompt(): void {
  const p = activeBot.value;
  if (activeBotPromptBuiltin.value) return;
  const found = p.prompts.find(x => x.id === p.activePromptId);
  if (!found) return;
  const input = window.prompt('重新命名提示词:', found.name);
  if (input === null) return;
  const name = input.trim();
  if (!name) {
    notify('warning', '名称不能为空');
    return;
  }
  found.name = name;
}

/** 🗑:删除当前提示词(至少保留一条;内置默认不可删)。 */
function removeBotPrompt(): void {
  const p = activeBot.value;
  if (p.prompts.length <= 1 || activeBotPromptBuiltin.value) return;
  const found = p.prompts.find(x => x.id === p.activePromptId);
  if (!found) return;
  if (!window.confirm(`删除提示词「${found.name}」?`)) return;
  p.prompts = p.prompts.filter(x => x.id !== found.id);
  p.activePromptId = p.prompts[0].id;
  botPromptText.value = p.prompts[0].content;
  p.systemPrompt = p.prompts[0].content;
}

/* ---- 快捷输入设置 ---- */
function addQuickTag(): void {
  settings.quickTags.push({ id: newId('qt'), title: '', content: '' });
}

function removeQuickTag(id: string): void {
  settings.quickTags = settings.quickTags.filter(q => q.id !== id);
}

/* ---- 快捷输入:长按拖柄排序(pointer 状态机,鼠标/触摸通用) ---- */
const qtListRef = ref<HTMLElement | null>(null);
/** 当前拖动源行号(-1 = 未拖动)。 */
const qtDragFrom = ref(-1);
/** 松手时的插入槽位(0..n;-1 = 落在原位/无效)。 */
const qtDragInsert = ref(-1);

const LONG_PRESS_MS = 320;
const MOVE_CANCEL_PX = 8;

interface QtDragState {
  pointerId: number;
  from: number;
  startX: number;
  startY: number;
  timer: number | null;
  active: boolean;
  ghost: HTMLElement | null;
}
let qtDrag: QtDragState | null = null;

function qtRows(): HTMLElement[] {
  const el = qtListRef.value;
  return el ? Array.from(el.querySelectorAll<HTMLElement>('[data-qt-row]')) : [];
}

/** 拖动时各源行/插入位的视觉 class。 */
function qtRowClass(i: number): Record<string, boolean> {
  return {
    'tlb-set__qtrow--src': qtDragFrom.value === i,
    'tlb-set__qtrow--before': qtDragInsert.value === i,
    'tlb-set__qtrow--after':
      qtDragInsert.value === settings.quickTags.length && i === settings.quickTags.length - 1,
  };
}

/** 按下拖柄:起一个长按计时,期间移动超过阈值则取消(让页面正常滚动)。 */
function onQtPointerDown(e: PointerEvent, index: number): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  qtDrag = {
    pointerId: e.pointerId,
    from: index,
    startX: e.clientX,
    startY: e.clientY,
    timer: window.setTimeout(() => startQtDrag(e), LONG_PRESS_MS),
    active: false,
    ghost: null,
  };
}

function cancelQtPress(): void {
  if (qtDrag?.timer) window.clearTimeout(qtDrag.timer);
  qtDrag = null;
}

/** 长按达成:进入拖动态,克隆源行做浮影。 */
function startQtDrag(e: PointerEvent): void {
  if (!qtDrag) return;
  const rows = qtRows();
  const src = rows[qtDrag.from];
  if (!src) {
    qtDrag = null;
    return;
  }
  qtDrag.active = true;
  qtDragFrom.value = qtDrag.from;

  const ghost = src.cloneNode(true) as HTMLElement;
  const rect = src.getBoundingClientRect();
  ghost.style.position = 'fixed';
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.margin = '0';
  ghost.style.zIndex = '9999';
  ghost.style.pointerEvents = 'none';
  ghost.style.opacity = '0.92';
  ghost.classList.add('tlb-qtghost');
  // 必须挂在 shadow root 内:样式表(link)只作用于 shadow 树;挂 body 会丢样式
  const root = src.getRootNode();
  (root instanceof ShadowRoot ? root : document.body).appendChild(ghost);
  qtDrag.ghost = ghost;

  // body 在 shadow 外,scoped 样式选不到,直接改行内样式
  document.body.style.cursor = 'grabbing';
  document.body.style.userSelect = 'none';
  if (e.cancelable) e.preventDefault();
  updateQtInsert(e.clientY);
}

function onQtPointerMove(e: PointerEvent): void {
  if (!qtDrag || e.pointerId !== qtDrag.pointerId) return;
  if (!qtDrag.active) {
    if (Math.hypot(e.clientX - qtDrag.startX, e.clientY - qtDrag.startY) > MOVE_CANCEL_PX) {
      cancelQtPress();
    }
    return;
  }
  e.preventDefault();
  if (qtDrag.ghost) {
    qtDrag.ghost.style.transform = `translate(${e.clientX - qtDrag.startX}px, ${e.clientY - qtDrag.startY}px)`;
  }
  updateQtInsert(e.clientY);
}

/** 按各行中点算插入槽位;落到源行原位时给 -1(不显示指示线)。 */
function updateQtInsert(y: number): void {
  if (!qtDrag) return;
  const rows = qtRows();
  let insert = rows.length;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (y < r.top + r.height / 2) {
      insert = i;
      break;
    }
  }
  const to = insert > qtDrag.from ? insert - 1 : insert;
  qtDragInsert.value = to === qtDrag.from ? -1 : insert;
}

function onQtPointerUp(e: PointerEvent): void {
  if (!qtDrag || e.pointerId !== qtDrag.pointerId) return;
  const wasActive = qtDrag.active;
  const from = qtDrag.from;
  const insert = qtDragInsert.value;
  finishQtDrag();
  if (!wasActive || insert < 0) return;
  const to = insert > from ? insert - 1 : insert;
  if (to !== from) {
    const list = settings.quickTags;
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
  }
}

function onQtPointerCancel(): void {
  finishQtDrag();
}

function finishQtDrag(): void {
  if (qtDrag?.timer) window.clearTimeout(qtDrag.timer);
  qtDrag?.ghost?.remove();
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  qtDrag = null;
  qtDragFrom.value = -1;
  qtDragInsert.value = -1;
}

onUnmounted(finishQtDrag);

/* ---- 导入 / 导出 JSON ---- */
async function downloadJson(): Promise<void> {
  if (!vibeList.loaded) await loadVibes();
  const payload: Record<string, unknown> = {
    type: 'st-taglab-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    // 创作资产
    artistPresets: settings.artistPresets,
    previews: Object.entries(artistPreviews).map(([id, dataUrl]) => ({ id, dataUrl })),
    vibes: vibeList.items.map(v => {
      const { busy: _busy, ...rest } = v;
      return rest;
    }),
    vibeGroups: settings.vibeGroups,
    quickTags: settings.quickTags,
    watermarkPresets: settings.watermarkPresets,
  };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `taglab-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function mergeByKey<T extends { id: string }>(list: T[], incoming: T[]): { added: number; updated: number } {
  let added = 0;
  let updated = 0;
  for (const item of incoming) {
    if (!item || typeof item.id !== 'string') continue;
    const exist = list.find(x => x.id === item.id);
    if (exist) {
      Object.assign(exist, item);
      updated++;
    } else {
      list.push(item);
      added++;
    }
  }
  return { added, updated };
}

/** Vibe 按 id 落盘并同步内存;返回 新增/更新数。 */
async function upsertVibes(incoming: unknown): Promise<{ added: number; updated: number }> {
  if (!Array.isArray(incoming)) return { added: 0, updated: 0 };
  let added = 0;
  let updated = 0;
  for (const raw of incoming) {
    if (!raw || typeof raw !== 'object' || typeof (raw as { id?: unknown }).id !== 'string') continue;
    const plain = { ...(raw as TlbVibe), busy: false };
    await saveVibe(plain);
    const idx = vibeList.items.findIndex(v => v.id === plain.id);
    if (idx >= 0) {
      vibeList.items[idx] = plain;
      updated++;
    } else {
      vibeList.items.push(plain);
      added++;
    }
  }
  return { added, updated };
}

async function importJson(file: File): Promise<void> {
  try {
    const data = JSON.parse(await file.text()) as Record<string, unknown>;
    const parts: string[] = [];

    if (Array.isArray(data.artistPresets) && data.artistPresets.length) {
      const r = mergeByKey(settings.artistPresets, data.artistPresets as TlbArtistPreset[]);
      parts.push(`画师串 +${r.added}/改${r.updated}`);
    }

    if (Number(data.version) >= 2) {
      const previews = Array.isArray(data.previews) ? data.previews : [];
      let pv = 0;
      for (const p of previews) {
        const rec = p as { id?: string; dataUrl?: string };
        if (rec?.id && rec.dataUrl) {
          await setArtistPreview(rec.id, rec.dataUrl);
          pv++;
        }
      }
      if (pv) parts.push(`预览图 ${pv}`);

      const vr = await upsertVibes(data.vibes);
      if (vr.added || vr.updated) parts.push(`Vibe +${vr.added}/改${vr.updated}`);

      for (const [field, key] of [
        ['vibeGroups', 'vibeGroups'],
        ['quickTags', 'quickTags'],
        ['watermarkPresets', 'watermarkPresets'],
      ] as const) {
        const r = mergeByKey(
          settings[key] as { id: string }[],
          (data[field] as { id: string }[]) ?? [],
        );
        if (r.added || r.updated) parts.push(`${key} +${r.added}/改${r.updated}`);
      }
    }

    notify('success', parts.join('；') || '文件里没有可导入的内容');
  } catch (e) {
    notify('error', `导入失败：${e instanceof Error ? e.message : '文件不是合法 JSON'}`);
  }
}

function onImportFile(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) importJson(file);
  input.value = '';
}

/* ---- 数据 ---- */
async function clearAll(): Promise<void> {
  if (!window.confirm(`删除全部 ${history.items.length} 条历史(含图片)?不可恢复。`)) return;
  await wipeHistory();
  notify('success', '历史已清空');
}

async function clearAllVibes(): Promise<void> {
  if (!vibeList.items.length) {
    notify('warning', 'vibe 库本来就是空的');
    return;
  }
  if (!window.confirm(`删除全部 ${vibeList.items.length} 条 vibe?不可恢复。`)) return;
  await wipeVibes();
  notify('success', 'vibe 库已清空');
}

function clearImgCache(): void {
  const n = clearImageUrlCache();
  notify('success', n ? `已释放 ${n} 张图片的会话缓存` : '当前没有会话缓存');
}

/* ---- 设置底部常驻资源链接(不折叠) ---- */
const RESOURCE_LINKS = [
  {
    name: 'Spell 咒语解析',
    url: 'https://looyun.github.io/spell/',
    desc: '拖入 AI 原图PNG即可提取提示词、画师/风格标签；纯浏览器本地解析，图片不上传。',
  },
  {
    name: 'Civitai',
    url: 'https://civitai.com/',
    desc: '全球最大的 AI 模型 / LoRA / 画风分享社区，很多图片有参数和提示词。',
  },
  {
    name: 'Civitai（成人分站）',
    url: 'https://civitai.red/',
    desc: 'Civitai 分支，男性向为主。',
  },
  {
    name: 'Anima 画风画廊',
    url: 'https://anima.mooshieblob.com/',
    desc: '收录 4.2 万+画师，按画师浏览风格效果样图。',
  },
  {
    name: 'NovelAI 标签云',
    url: 'https://novelai.quicktagcloud.com/?c=artist_nai5_personal',
    desc: '按使用热度浏览 NAI 标签，此链接直达 NAI5 画师标签。',
  },
  {
    name: 'NAI 画师融合法典',
    url: 'https://nai-bot.pages.dev/%E6%B3%95%E5%85%B8/artists-gallery/',
    desc: '433 组画师画风融合配方，附 SMEA/构图成图对比，词条可一键复制。',
  },
] as const;
</script>

<template>
  <div class="tlb-set">
    <!-- NAI 配置 -->
    <section class="tlb-card">
      <button class="tlb-card__head" type="button" @click="open.nai = !open.nai">
        <Icon name="server" />
        <b>NAI配置</b>
        <span class="tlb-grow" />
        <Icon :name="open.nai ? 'chevron-up' : 'chevron-down'" :size="16" />
      </button>
      <div v-if="open.nai" class="tlb-card__body">
        <!-- 接入点:与生成页「画师串预设」100% 同款:下拉载入草稿 → ＋另存/💾保存/rename/🗑 -->
        <div class="tlb-cfg__field">
          <span class="tlb-cfg__label">接入点</span>
          <div class="tlb-row tlb-presetrow">
            <TlbSelect
              v-model="settings.nai.activeEndpointId"
              class="tlb-presetrow__sel"
              :options="settings.nai.endpoints.map(ep => ({ value: ep.id, label: ep.name }))"
            />
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon" type="button" title="当前地址/Key 另存为新接入点(弹窗命名)" @click="saveEndpointAs">
              <Icon name="plus" />
            </button>
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon" type="button" title="保存到当前接入点" @click="saveEndpoint">
              <Icon name="save" />
            </button>
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon" type="button" :disabled="activeIsOfficial" title="重新命名当前接入点(官方名称固定)" @click="renameEndpoint">
              <Icon name="rename" />
            </button>
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon" type="button" :disabled="activeIsOfficial" title="删除当前接入点(官方不可删)" @click="removeEndpoint">
              <Icon name="trash" />
            </button>
          </div>
        </div>

        <!-- 接口地址 -->
        <div class="tlb-cfg__field">
          <span class="tlb-cfg__label">接口地址</span>
          <input v-model="epDraft.url" class="tlb-input" :disabled="activeIsOfficial" :placeholder="activeIsOfficial ? '官方地址固定' : 'https://'" />
          <p v-if="activeIsOfficial" class="tlb-hint">官方API时使用默认地址；点击「+」可新增第三方接入点</p>
        </div>

        <!-- API Key:眼睛嵌在输入框内右侧 -->
        <div class="tlb-cfg__field">
          <span class="tlb-cfg__label">API Key</span>
          <div class="tlb-keyinp">
            <input
              v-model="epDraft.key"
              class="tlb-input tlb-keyinp__input"
              :type="showKey ? 'text' : 'password'"
              placeholder="粘贴 API Key"
              autocomplete="off"
            />
            <button
              class="tlb-keyinp__eye"
              type="button"
              :title="showKey ? '隐藏 Key' : '显示 Key'"
              @click="showKey = !showKey"
            >
              <Icon :name="showKey ? 'eye-off' : 'eye'" :size="17" />
            </button>
          </div>
        </div>

        <!-- 测试连接(靠左) -->
        <button class="tlb-btn tlb-btn--sm" :disabled="testing" @click="test">
          <Icon :name="testing ? 'loader' : 'plug'" :spin="testing" :size="15" /> 测试连接
        </button>
      </div>
    </section>

    <!-- 提示词助手 -->
    <section class="tlb-card">
      <button class="tlb-card__head" type="button" @click="open.bot = !open.bot">
        <Icon name="robot" />
        <b>提示词助手</b>
        <span class="tlb-grow" />
        <Icon :name="open.bot ? 'chevron-up' : 'chevron-down'" :size="16" />
      </button>
      <div v-if="open.bot" class="tlb-card__body">
        <!-- 配置档:与生成页「画师串预设」100% 同款:下拉载入草稿 → ＋另存/💾保存/rename/🗑 -->
        <div class="tlb-row tlb-presetrow">
          <TlbSelect
            v-model="settings.bot.activeProfileId"
            class="tlb-presetrow__sel"
            :options="settings.bot.profiles.map(p => ({ value: p.id, label: p.name }))"
          />
          <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon" type="button" title="当前表单另存为新配置档(弹窗命名)" @click="saveBotProfileAs">
            <Icon name="plus" />
          </button>
          <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon" type="button" title="把当前表单保存到当前配置档" @click="saveBotProfile">
            <Icon name="save" />
          </button>
          <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon" type="button" title="重新命名当前配置档" @click="renameBotProfile">
            <Icon name="rename" />
          </button>
          <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon" type="button" :disabled="botLastOne" title="删除当前配置档(至少保留一档)" @click="removeBotProfile">
            <Icon name="trash" />
          </button>
        </div>

        <div class="tlb-cfg__field">
          <span class="tlb-cfg__label">Provider</span>
          <TlbSelect
            :model-value="botDraft.provider"
            :options="BOT_PROVIDERS.map(prov => ({ value: prov.id, label: prov.name }))"
            @change="onProviderChange"
          />
        </div>

        <!-- Base URL / API Key 同一行(草稿,点 💾 才写回) -->
        <div class="tlb-cfg__tworow">
          <div class="tlb-cfg__cell">
            <span class="tlb-cfg__sublabel">Base URL</span>
            <input v-model="botDraft.baseUrl" class="tlb-input" placeholder="https://api.openai.com/v1" />
          </div>
          <div class="tlb-cfg__cell">
            <span class="tlb-cfg__sublabel">API Key</span>
            <div class="tlb-keyinp">
              <input
                v-model="botDraft.key"
                class="tlb-input tlb-keyinp__input"
                :type="showBotKey ? 'text' : 'password'"
                placeholder="粘贴 API Key"
                autocomplete="off"
              />
              <button
                class="tlb-keyinp__eye"
                type="button"
                :title="showBotKey ? '隐藏 Key' : '显示 Key'"
                @click="showBotKey = !showBotKey"
              >
                <Icon :name="showBotKey ? 'eye-off' : 'eye'" :size="17" />
              </button>
            </div>
          </div>
        </div>

        <!-- Model:可直接输入,也可从已拉取列表选 -->
        <div class="tlb-cfg__field">
          <span class="tlb-cfg__label">Model</span>
          <div class="tlb-cfg__ctrlrow">
            <div class="tlb-modeldd tlb-cfg__grow">
              <input
                v-model="botDraft.model"
                class="tlb-input tlb-modeldd__input"
                placeholder="填写模型 id,或点右侧 ∨ 从已拉取列表选"
                autocomplete="off"
                @focus="botModelOpen = true"
              />
              <button
                type="button"
                class="tlb-modeldd__btn"
                :title="botModelOpen ? '收起列表' : '展开已拉取模型'"
                @click="botModelOpen = !botModelOpen"
              >
                <Icon :name="botModelOpen ? 'chevron-up' : 'chevron-down'" :size="15" />
              </button>
              <div v-if="botModelOpen" class="tlb-modeldd__mask" @click="botModelOpen = false" />
              <ul v-if="botModelOpen" class="tlb-modeldd__menu">
                <li v-if="!activeBot.models.length" class="tlb-modeldd__empty">尚未拉取到模型,点右侧「拉取模型」</li>
                <li
                  v-for="m in activeBot.models"
                  :key="m"
                  class="tlb-modeldd__item"
                  :class="{ 'is-active': m === botDraft.model }"
                  @click="pickBotModel(m)"
                >{{ m }}</li>
              </ul>
            </div>
            <button class="tlb-btn tlb-btn--sm" :disabled="botLoading" @click="fetchBotModels">
              <Icon :name="botLoading ? 'loader' : 'cloud-down'" :spin="botLoading" :size="15" /> 拉取模型
            </button>
          </div>
        </div>

        <!-- 系统提示词:与画师串预设同款(下拉载入正文 → ＋另存/💾保存/rename/🗑) -->
        <div class="tlb-cfg__field">
          <span class="tlb-cfg__label">系统提示词</span>
          <div class="tlb-row tlb-presetrow">
            <TlbSelect
              class="tlb-presetrow__sel"
              :model-value="activeBot.activePromptId"
              :options="activeBot.prompts.map(pp => ({ value: pp.id, label: pp.name }))"
              @change="pickBotPrompt"
            />
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon" type="button" title="正文另存为新提示词(弹窗命名,内置默认只读,请另存后修改)" @click="saveBotPromptAs">
              <Icon name="plus" />
            </button>
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon" type="button" :disabled="activeBotPromptBuiltin" title="把正文保存到所选提示词(内置默认不可改)" @click="saveBotPrompt">
              <Icon name="save" />
            </button>
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon" type="button" :disabled="activeBotPromptBuiltin" title="重新命名所选提示词(内置默认不可改名)" @click="renameBotPrompt">
              <Icon name="rename" />
            </button>
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon" type="button" :disabled="botPromptLastOne || activeBotPromptBuiltin" title="删除所选提示词(内置默认不可删)" @click="removeBotPrompt">
              <Icon name="trash" />
            </button>
          </div>
          <textarea
            v-model="botPromptText"
            class="tlb-textarea tlb-botprompt__ta"
            :class="{ 'is-readonly': activeBotPromptBuiltin }"
            :readonly="activeBotPromptBuiltin"
            rows="4"
            :placeholder="activeBotPromptBuiltin ? '内置默认提示词(只读);要修改请点「＋」另存' : '引导它只输出 tag'"
          />
        </div>
      </div>
    </section>

    <!-- 从柏宝绘同步 -->
    <section class="tlb-card">
      <button class="tlb-card__head" type="button" @click="open.sync = !open.sync">
        <Icon name="refresh" />
        <b>同步</b>
        <span class="tlb-grow" />
        <Icon :name="open.sync ? 'chevron-up' : 'chevron-down'" :size="16" />
      </button>
      <div v-if="open.sync" class="tlb-card__body">
        <p class="tlb-hint">
          单向只读读取对方数据（绝不改动对方）：画师串、正/负词、预览图、vibe 与 vibe 组。
          画师串<b>以名称为准，重名自动覆盖</b>；先同步一家再同步另一家时，后者独有的预览图/vibe 会补进同名条目。
          vibe 按编码指纹增量合并、<b>导入后默认不启用</b>。可重复点按更新。
        </p>

        <div class="tlb-sync-item">
          <div class="tlb-sync-item__meta">
            <b>柏宝绘 ST-BaiBai-Image</b>
            <span class="tlb-hint">NAI 配置（接入点/模型/采样器/尺寸/质量词）、画师串、预览图、vibe 与组；负词为完整口径原样搬。</span>
            <span class="tlb-sync-item__time">上次：{{ syncTime(settings.lastBaibaiSyncAt) }}</span>
          </div>
          <button class="tlb-btn tlb-btn--accent tlb-btn--sm" :disabled="anySyncing" @click="runSync('baibai')">
            <Icon :name="syncState.baibai.busy ? 'loader' : 'download'" :spin="syncState.baibai.busy" />
            {{ syncState.baibai.busy ? (syncState.baibai.status || '同步中…') : '同步' }}
          </button>
        </div>

        <div class="tlb-sync-item">
          <div class="tlb-sync-item__meta">
            <b>智绘姬 st-chatu8</b>
            <span class="tlb-hint">画师串、正/负词(已烤入官方默认负面词基线)、预览图、vibe 预设与组;需在智绘姬里保存过数据。</span>
            <span class="tlb-sync-item__time">上次：{{ syncTime(settings.lastChatu8SyncAt) }}</span>
          </div>
          <button class="tlb-btn tlb-btn--accent tlb-btn--sm" :disabled="anySyncing" @click="runSync('chatu8')">
            <Icon :name="syncState.chatu8.busy ? 'loader' : 'download'" :spin="syncState.chatu8.busy" />
            {{ syncState.chatu8.busy ? (syncState.chatu8.status || '同步中…') : '同步' }}
          </button>
        </div>

        <div class="tlb-sync-item">
          <div class="tlb-sync-item__meta">
            <b>小白X LittleWhiteBox(NovelDraw)</b>
            <span class="tlb-hint">画师串、正/负词、缩略预览图、vibe 库与组；读取服务器上的 LittleWhiteBox_NovelDraw.json。</span>
            <span class="tlb-sync-item__time">上次：{{ syncTime(settings.lastXiaobaiSyncAt) }}</span>
          </div>
          <button class="tlb-btn tlb-btn--accent tlb-btn--sm" :disabled="anySyncing" @click="runSync('xiaobaix')">
            <Icon :name="syncState.xiaobaix.busy ? 'loader' : 'download'" :spin="syncState.xiaobaix.busy" />
            {{ syncState.xiaobaix.busy ? (syncState.xiaobaix.status || '同步中…') : '同步' }}
          </button>
        </div>
      </div>
    </section>

    <!-- 快捷输入设置 -->
    <section class="tlb-card">
      <button class="tlb-card__head" type="button" @click="open.quick = !open.quick">
        <Icon name="tag" />
        <b>快捷输入({{ settings.quickTags.length }})</b>
        <span class="tlb-grow" />
        <Icon :name="open.quick ? 'chevron-up' : 'chevron-down'" :size="16" />
      </button>
      <div v-if="open.quick" class="tlb-card__body">
        <div class="tlb-row">
          <h3 class="tlb-tiphead">
            横滑按钮
            <span class="tlb-tip" tabindex="0">
              <Icon name="info" />
              <span class="tlb-tip__body">生成页正面词下方的横滑按钮：按钮显示「标题」（标题留空时显示内容）；点选把「内容」插入正面词输入框。</span>
            </span>
          </h3>
          <span class="tlb-grow" />
          <button class="tlb-btn tlb-btn--sm" @click="addQuickTag"><Icon name="plus" /> 新增</button>
        </div>
        <div v-if="!settings.quickTags.length" class="tlb-hint" style="margin-top: 8px">还没有快捷输入。</div>
        <div
          ref="qtListRef"
          class="tlb-qtlist"
          :class="{ 'tlb-qtlist--dragging': qtDragFrom >= 0 }"
        >
          <div
            v-for="(q, i) in settings.quickTags"
            :key="q.id"
            class="tlb-row tlb-set__qtrow"
            :class="qtRowClass(i)"
            :data-qt-row="i"
          >
            <button
              type="button"
              class="tlb-qtgrip"
              title="长按拖动排序"
              tabindex="-1"
              @pointerdown="onQtPointerDown($event, i)"
              @pointermove="onQtPointerMove"
              @pointerup="onQtPointerUp"
              @pointercancel="onQtPointerCancel"
            >
              <Icon name="grip" :size="15" />
            </button>
            <input v-model="q.title" class="tlb-input tlb-set__qt-title" placeholder="标题(可空)" />
            <input v-model="q.content" class="tlb-input tlb-grow" placeholder="插入内容,如 1girl, red dress" />
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon" title="删除" @click="removeQuickTag(q.id)">
              <Icon name="trash" />
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 资料管理(含导入导出) -->
    <section class="tlb-card">
      <button class="tlb-card__head" type="button" @click="open.data = !open.data">
        <Icon name="database" />
        <b>资料管理</b>
        <span class="tlb-grow" />
        <Icon :name="open.data ? 'chevron-up' : 'chevron-down'" :size="16" />
      </button>
      <div v-if="open.data" class="tlb-card__body">
        <div class="tlb-row">
          <h3 class="tlb-tiphead">
            全量备份
            <span class="tlb-tip" tabindex="0">
              <Icon name="info" />
              <span class="tlb-tip__body">导出画师串、预览图、Vibe、快捷输入、水印样式等创作资产；导入按 id 合并：同名覆盖、新条目追加，不影响其他资料。</span>
            </span>
          </h3>
          <span class="tlb-grow" />
          <button class="tlb-btn tlb-btn--sm" @click="downloadJson"><Icon name="file-down" /> 导出 JSON</button>
          <label class="tlb-btn tlb-btn--sm" style="cursor: pointer; margin-left: 6px">
            <Icon name="file-up" /> 导入 JSON
            <input type="file" accept="application/json,.json" style="display: none" @change="onImportFile" />
          </label>
        </div>
        <div class="tlb-cfg__divider" />
        <div class="tlb-set__data">
          <div class="tlb-row">
            <span class="tlb-hint tlb-grow">历史图片 {{ history.items.length }} 张（IndexedDB，不进柏宝绘）</span>
            <button class="tlb-btn tlb-btn--danger tlb-btn--sm" :disabled="!history.items.length" @click="clearAll">清空历史</button>
          </div>
          <div class="tlb-row">
            <span class="tlb-hint tlb-grow">vibe 库 {{ vibeList.items.length }} 条</span>
            <button class="tlb-btn tlb-btn--danger tlb-btn--sm" :disabled="!vibeList.items.length" @click="clearAllVibes">清空 vibe 库</button>
          </div>
          <div class="tlb-row">
            <span class="tlb-hint tlb-grow">本会话图片缓存(关闭面板后也会自动释放)</span>
            <button class="tlb-btn tlb-btn--sm" @click="clearImgCache">清除缓存</button>
          </div>
        </div>
      </div>
    </section>

    <!-- 常用资源:常驻展示,不折叠 -->
    <div class="tlb-set__links">
      <h3 class="tlb-set__links-title">
        <Icon name="bookmark" :size="14" /> 常用资源
      </h3>
      <ul class="tlb-set__linklist">
        <li v-for="r in RESOURCE_LINKS" :key="r.url">
          <a
            class="tlb-set__link"
            :href="r.url"
            target="_blank"
            rel="noopener noreferrer"
            title="点击打开"
          >{{ r.name }}<Icon name="external" :size="11" /></a><span class="tlb-hint"> - {{ r.desc }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.tlb-set {
  padding-bottom: 10px;
}

.tlb-set__data {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ---- 系统提示词:正文框与上方按钮列拉开;只读态视觉提示 ---- */
.tlb-botprompt__ta {
  margin-top: 8px;
}

.tlb-botprompt__ta.is-readonly {
  opacity: 0.85;
  cursor: default;
  resize: none;
}

/* ---- 底部常用资源链接(常驻,不折叠) ---- */
.tlb-set__links {
  margin: 14px 2px 4px;
}

.tlb-set__links-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--tlb-ink-soft);
}

.tlb-set__linklist {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tlb-set__linklist li {
  font-size: 12.5px;
  line-height: 1.6;
}

.tlb-set__link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--tlb-accent, #7c5cff);
  font-weight: 600;
  text-decoration: none;
}

.tlb-set__link:hover {
  text-decoration: underline;
}

/* 快捷输入行:标题窄框 + 内容宽框 + 删除钮 */
.tlb-set__qtrow {
  gap: 6px;
  margin-top: 8px;
}

.tlb-set__qt-title {
  flex: none;
  width: 110px;
}

/* ---- 快捷输入:长按拖柄排序 ---- */
.tlb-qtgrip {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--tlb-radius, 8px);
  background: transparent;
  color: var(--tlb-ink-muted);
  cursor: grab;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}

.tlb-qtgrip:active {
  cursor: grabbing;
}

/* 被拖动的源行在原位变淡,浮影(ghost)由 JS 克隆到 body */
.tlb-set__qtrow--src {
  opacity: 0.35;
}

/* 插入槽位指示线:目标行上方 / 末尾行下方 */
.tlb-set__qtrow--before::before,
.tlb-set__qtrow--after::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  border-radius: 1px;
  background: var(--tlb-accent, #7c5cff);
  pointer-events: none;
}

.tlb-set__qtrow--before::before {
  top: -5px;
}

.tlb-set__qtrow--after::after {
  bottom: -5px;
}

/* 拖动期间整行用相对定位承载指示线;禁止文本误选 */
.tlb-qtlist--dragging .tlb-set__qtrow {
  position: relative;
}

.tlb-qtghost {
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius, 8px);
  background: var(--tlb-surface);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
}

/* ---- 统一折叠卡片 ---- */
.tlb-card {
  margin: 8px 0;
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius);
  background: var(--tlb-surface);
  overflow: hidden;
}

.tlb-card__head {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--tlb-ink);
  font-size: 13.5px;
  padding: 10px 12px;
  cursor: pointer;
}

.tlb-card__head:hover {
  background: var(--tlb-surface-2);
}

.tlb-card__body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 10px 12px 12px;
  border-top: 1px solid var(--tlb-line);
}

/* ---- 三向同步条目 ---- */
.tlb-sync-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--tlb-line);
  border-radius: 8px;
}

.tlb-sync-item__meta {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tlb-sync-item__time {
  font-size: 11px;
  opacity: 0.7;
}

/* ---- 预设按钮组:与生成页「画师串预设」行完全同款 ---- */
.tlb-presetrow {
  gap: 5px;
}

.tlb-presetrow .tlb-btn--icon {
  width: 26px;
  height: 26px;
}

.tlb-presetrow__sel {
  flex: 1 1 auto;
  min-width: 0;
  height: 26px;
}

/* ---- 配置卡内部通用(NAI配置 / 提示词助手) ---- */
.tlb-cfg__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tlb-cfg__label {
  flex: none;
  font-size: 13px;
  font-weight: 600;
  color: var(--tlb-ink);
}

.tlb-cfg__ctrlrow {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tlb-cfg__grow {
  flex: 1 1 auto;
  min-width: 0;
}

/* 一行两列(Base URL / API Key) */
.tlb-cfg__tworow {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}

.tlb-cfg__cell {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tlb-cfg__sublabel {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--tlb-ink-soft);
}

/* 行内按钮与输入框同高 */
.tlb-cfg__ctrlrow .tlb-btn:not(.tlb-btn--icon) {
  flex: none;
}

/* ---- 带内嵌眼睛图标的输入框 ---- */
.tlb-keyinp {
  position: relative;
  display: flex;
}

.tlb-keyinp__input {
  width: 100%;
  padding-right: 34px;
}

.tlb-keyinp__eye {
  position: absolute;
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--tlb-ink-soft);
  cursor: pointer;
}

.tlb-keyinp__eye:hover {
  color: var(--tlb-accent);
}

/* ---- Model 可输入+可展开下拉 ---- */
.tlb-modeldd {
  position: relative;
  display: flex;
}

.tlb-modeldd__input {
  width: 100%;
  padding-right: 32px;
}

.tlb-modeldd__btn {
  position: absolute;
  top: 50%;
  right: 3px;
  transform: translateY(-50%);
  z-index: 3;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--tlb-ink-soft);
  cursor: pointer;
}

.tlb-modeldd__btn:hover {
  color: var(--tlb-accent);
}

.tlb-modeldd__mask {
  position: fixed;
  inset: 0;
  z-index: 40;
}

.tlb-modeldd__menu {
  position: absolute;
  top: calc(100% + 3px);
  left: 0;
  right: 0;
  z-index: 41;
  margin: 0;
  padding: 4px;
  max-height: 240px;
  overflow-y: auto;
  list-style: none;
  background: var(--tlb-surface);
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius, 8px);
  box-shadow: var(--tlb-shadow, 0 8px 24px rgba(0, 0, 0, 0.35));
}

.tlb-modeldd__item {
  padding: 6px 8px;
  font-size: 12.5px;
  color: var(--tlb-ink);
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tlb-modeldd__item:hover {
  background: var(--tlb-line);
}

.tlb-modeldd__item.is-active {
  color: var(--tlb-accent);
  font-weight: 600;
}

.tlb-modeldd__empty {
  padding: 8px;
  font-size: 12px;
  color: var(--tlb-ink-soft);
}

/* ---- 小标题 + ⓘ 说明浮层(同生成页 vibe 标题) ---- */
.tlb-tiphead {
  position: relative; /* ⓘ 浮层以标题为定位锚点 */
  margin: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--tlb-ink-soft);
  display: inline-flex;
  align-items: center;
}

.tlb-tip {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  color: var(--tlb-ink-muted);
  font-weight: normal;
  cursor: help;
  outline: none;
  vertical-align: middle;
}

.tlb-tip:hover,
.tlb-tip:focus {
  color: var(--tlb-ink);
}

.tlb-tip__body {
  display: none;
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 60;
  width: 280px;
  max-width: calc(100vw - 48px);
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--tlb-line);
  background: var(--tlb-surface);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  color: var(--tlb-ink-muted);
  font-size: 12px;
  font-weight: normal;
  line-height: 1.7;
  text-align: left;
  white-space: normal;
}

.tlb-tip:hover .tlb-tip__body,
.tlb-tip:focus .tlb-tip__body,
.tlb-tip:focus-within .tlb-tip__body {
  display: block;
}

/* 资料管理:导入导出与清理区之间的分隔线 */
.tlb-cfg__divider {
  height: 1px;
  background: var(--tlb-line);
}
</style>
