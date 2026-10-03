<script setup lang="ts">
/**
 * 生成主界面(默认视图,非底栏 tab)。
 * 布局对齐设计图:左侧 = 画师串预设 + 画师串输入框 + 正面/负面提示词 + AI 生成/NAI 生成;
 * 右侧 = Vibe Transfer(占位);下方 = 图片大图(滑动切换 + 回填)。
 * 回填口径:滑到某张历史图时,把它的**原始正向词**填回编辑框(不含画师串/质量词)。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import {
  buildLwbVibeGroup,
  buildNaiv4vibe,
  encodeVibeImage,
  generateNaiImage,
  parseVibeFile,
  samplersForModel,
} from '@/nai/client';
import { chat, extractTags } from '@/nai/bot';
import { NAI_MODELS, NAI_NOISE_SCHEDULES, clampVibeStrength, vibeLocalModelKey } from '@/constants';
import { activeArtistPreset, activeBotProfile, activeEndpoint, artistStore, newId, selectArtist, settings } from '@/state/settings';
import { addHistory, currentItem, history, loadHistory, stepSelection } from '@/state/historyList';
import { applyBackfill } from '@/state/backfill';
import { artistDraft, downscaleFileToDataUrl, imageUrl, promptDraft, ui } from '@/state/ui';
import {
  addVibe,
  addVibeGroup,
  applyVibeGroup,
  deleteVibeGroup,
  loadVibes,
  overwriteVibeGroup,
  removeVibe,
  renameVibeGroup,
  saveVibeGroupAs,
  updateVibe,
  vibeList,
  vibeSelection,
} from '@/state/vibeList';
import { notify } from '@/st/toast';
import Icon from '@/components/Icon.vue';
import InputActions from '@/components/InputActions.vue';
import TlbSelect from '@/components/TlbSelect.vue';
import { usePanelAnchor } from '@/use/panelAnchor';
import { useIsMobile } from '@/use/useIsMobile';
import type { TlbHistoryMeta, TlbVibe, TlbVibeGroup } from '@/types';

/* 移動端判定(matchMedia + UA 雙保險,見 useIsMobile):驅動單列佈局類名。
   不用純 CSS @media —— 安卓 ST 網頁版桌面模式 viewport≈980 會漏接 760 斷點。 */
const isMobile = useIsMobile();

const showParams = ref(false);
const showNegative = ref(false);

const status = ref('');
const generating = ref(false);
const botGen = ref(false);
const error = ref('');

onMounted(() => {
  if (!history.loaded) void loadHistory();
  if (!vibeList.loaded) void loadVibes();
});

/* ---- 画师串:下拉选预设 → 草稿载入;编辑只动草稿,必须点「保存」才写回预设。
 * 未选预设时编辑的是 artistDraft(回填旧图留下的临时画师串,会话级、仍参与拼装)。 */
const artistText = ref('');

// 切换预设 / 回填改选预设:重新载入该预设内容(丢弃未保存草稿)
watch(
  () => settings.activeArtistId,
  () => {
    artistText.value = activeArtistPreset()?.prompt ?? '';
  },
  { immediate: true },
);

const artistPrompt = computed<string>({
  get: () => (activeArtistPreset() ? artistText.value : artistDraft.text),
  set: (v: string) => {
    if (activeArtistPreset()) artistText.value = v;
    else artistDraft.text = v;
  },
});

/** 下拉手动选择(含「不使用」):清掉临时画师串草稿。 */
function onArtistPick(id: string | number): void {
  selectArtist(String(id));
}

const artistPlaceholder = computed(() =>
  activeArtistPreset()
    ? '画师/画风 tag,如:artist:xxx, ...'
    : artistDraft.text
      ? '(非预设的临时画师串,未选预设;手动选择即清除)'
      : '先选择或新建一个画师串预设',
);

/** 保存:把草稿写入当前预设(唯一的写回入口)。 */
function saveArtist(): void {
  const p = activeArtistPreset();
  if (!p) {
    notify('warning', '先选择一个画师串预设');
    return;
  }
  p.prompt = artistText.value.trim();
  notify('success', `画师串「${p.name}」已保存`);
}

/** 另存:用当前草稿建一个新预设,弹窗要求命名。 */
function saveArtistAs(): void {
  const text = artistPrompt.value.trim();
  const cur = activeArtistPreset();
  const input = window.prompt('另存为新画师串,输入名称:', cur ? `${cur.name} 副本` : '新画师串');
  if (input === null) return;
  const name = input.trim();
  if (!name) {
    notify('warning', '名称不能为空');
    return;
  }
  const item = artistStore.add({ name, prompt: text });
  selectArtist(item.id);
  notify('success', `已另存为「${name}」`);
}

/** 重新命名当前预设。 */
function renameArtist(): void {
  const p = activeArtistPreset();
  if (!p) {
    notify('warning', '先选择一个画师串预设');
    return;
  }
  const input = window.prompt('重新命名画师串:', p.name);
  if (input === null) return;
  const name = input.trim();
  if (!name) {
    notify('warning', '名称不能为空');
    return;
  }
  p.name = name;
  notify('success', `已改名为「${name}」`);
}

function removeArtist(): void {
  const p = activeArtistPreset();
  if (!p) return;
  if (!window.confirm(`删除画师串「${p.name}」?`)) return;
  artistStore.remove(p.id);
}

/** 清空画师串输入框(预设内容 / 临时串各自归位)。 */
function clearArtist(): void {
  artistPrompt.value = '';
}

/* ---- 复制 ---- */
async function copyText(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    notify('success', `${label}已复制`);
  } catch {
    notify('error', '复制失败(浏览器未授权剪贴板)');
  }
}

/* ---- 当前图与 URL ---- */
const current = computed<TlbHistoryMeta | null>(() => currentItem());
const currentUrl = ref<string | null>(null);

watch(
  () => ui.currentId,
  async id => {
    currentUrl.value = id ? await imageUrl(id) : null;
    if (id) void runBackfill(current.value);
  },
  { immediate: true },
);

// 预览弹窗「回傳生成」:currentId 可能没变,靠 nonce 再触发一次回填
watch(
  () => ui.backfillNonce,
  () => {
    if (ui.tab === 'gen' && current.value) void runBackfill(current.value);
  },
);

watch(history, () => {
  const id = ui.currentId;
  if (id && !urlKeyed(id)) {
    void imageUrl(id).then(u => (currentUrl.value = u));
  }
});

function urlKeyed(id: string): boolean {
  return current.value?.id === id;
}

/** 回填该图的全部信息(画师串/提示词/质量词/负面词/vibe/参数);vibe 缺失时提示。 */

async function runBackfill(meta: TlbHistoryMeta | null): Promise<void> {
  if (!meta) return;
  // 种子不回填:始终保持 0(随机),想复刻再手填
  error.value = '';
  const r = await applyBackfill(meta);
  // 回填可能改选预设(id 不变时 watcher 不触发),草稿一律按当前预设重载
  artistText.value = activeArtistPreset()?.prompt ?? '';
  // 回填会按历史快照重排 vibe 勾选,组选择必然不再对应,复位
  vibeSelection.groupId = '';
  setVibeStatus('');
  if (r.missingVibeIds.length) {
    setVibeStatus(`该图使用的 ${r.missingVibeIds.length} 个 vibe 已不存在,未勾选`, 'error');
  }
}

/* ---- 快捷输入:插到光标处(无 textarea 焦点时追加到末尾) ---- */
const promptEl = ref<HTMLTextAreaElement | null>(null);

/** chip 行只显示内容非空的条目(设置页里正在编辑的空行不出现)。 */
const usableQuickTags = computed(() => settings.quickTags.filter(q => q.content.trim()));

async function insertQuickTag(tag: string): Promise<void> {
  const ta = promptEl.value;
  if (!ta) {
    const cur = promptDraft.text.trim();
    promptDraft.text = cur ? `${cur.replace(/[,\s]+$/, '')}, ${tag}` : tag;
    return;
  }
  const cur = promptDraft.text;
  const start = ta.selectionStart ?? cur.length;
  const end = ta.selectionEnd ?? start;
  const left = cur.slice(0, start);
  const right = cur.slice(end);
  let piece = tag;
  if (left.trim() && !/,\s*$/.test(left)) piece = `, ${piece}`;
  if (right.trim() && !/^\s*,/.test(right)) piece = `${piece}, `;
  promptDraft.text = left + piece + right;
  const pos = (left + piece).length;
  await nextTick();
  ta.focus();
  ta.setSelectionRange(pos, pos);
}

/* ---- 放大输入框:画师串/正面词/负面词三类输入框共用同一个模态 ---- */
const zoomTarget = ref<null | 'prompt' | 'artist' | 'negative'>(null);

const ZOOM_TITLES: Record<string, string> = { prompt: '正面提示词', artist: '画师串', negative: '负面提示词' };

const { backdropEl: zoomBackdropEl, anchorStyle: zoomAnchorStyle } = usePanelAnchor(zoomTarget);

const zoomText = computed<string>({
  get: () => {
    switch (zoomTarget.value) {
      case 'artist':
        return artistPrompt.value;
      case 'negative':
        return settings.nai.undesiredContent;
      default:
        return promptDraft.text;
    }
  },
  set: (v: string) => {
    switch (zoomTarget.value) {
      case 'artist':
        artistPrompt.value = v;
        break;
      case 'negative':
        settings.nai.undesiredContent = v;
        break;
      default:
        promptDraft.text = v;
        break;
    }
  },
});

function clearPrompt(): void {
  if (!promptDraft.text.trim()) return;
  promptDraft.text = '';
  promptEl.value?.focus();
}

/* ---- 预览弹窗入口(区分滑动手势与点击;只有点在图片上才放大) ---- */
let gestured = false;

function onPreviewClick(e: MouseEvent): void {
  if (gestured) {
    gestured = false;
    return;
  }
  // 手势 setPointerCapture 会把 click 的 target 重定向成容器,
  // 不能再用 e.target 判定;改为按真实坐标命中 <img> 的包围盒
  const img = previewEl.value?.querySelector('img');
  if (!img || !current.value) return;
  const r = img.getBoundingClientRect();
  if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
    ui.previewOpen = true;
  }
}

/* ---- 滑动手势 ---- */
const previewEl = ref<HTMLElement | null>(null);
let swipeStart: { x: number; y: number } | null = null;

function onSwipeDown(e: PointerEvent): void {
  // 点在箭头等控件上:不接管手势,保证 click 正常
  if ((e.target as HTMLElement).closest('button,a,input')) return;
  swipeStart = { x: e.clientX, y: e.clientY };
  gestured = false;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onSwipeMove(e: PointerEvent): void {
  if (!swipeStart) return;
  const dx = e.clientX - swipeStart.x;
  const dy = e.clientY - swipeStart.y;
  if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    stepSelection(dx < 0 ? 1 : -1); // 左滑 = 更旧,右滑 = 更新
    gestured = true; // 抑制本次抬手后的 click 打开预览
    swipeStart = null;
  }
}

function onSwipeUp(): void {
  swipeStart = null;
}

/* ---- NAI 生成(把提示词发出去出图) ---- */
async function generate(): Promise<void> {
  if (generating.value) return;
  error.value = '';
  generating.value = true;
  status.value = '生成中;若有缺失编码的 vibe 会先自动编码…';
  try {
    // 种子取「生图参数」里的默认种子(0=随机),不再提供单次覆写
    const result = await generateNaiImage({ prompt: promptDraft.text });
    await addHistory(result.meta, result.blob);
    status.value = `完成 · ${result.meta.width}×${result.meta.height} · seed ${result.meta.seed}`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    status.value = '';
  } finally {
    generating.value = false;
  }
}

/* ---- AI 生成 = Bot 把自然语言转成 tag,填入提示词 ---- */
async function aiGenerate(): Promise<void> {
  const desc = promptDraft.text.trim();
  if (!desc) {
    notify('warning', '先在正面提示词里写自然语言描述');
    return;
  }
  const bot = activeBotProfile();
  if (!bot.baseUrl.trim() || !bot.key.trim()) {
    notify('warning', '未配置提示词助手:到「设置 → 提示词助手」填接口地址与 Key');
    return;
  }
  botGen.value = true;
  try {
    const reply = await chat([{ role: 'user', content: desc }]);
    const tags = extractTags(reply);
    if (!tags) {
      notify('warning', 'Bot 没返回可用的 tag');
      return;
    }
    promptDraft.text = tags;
    notify('success', '已用 Bot 生成 tag,再点「NAI 生成」出图');
  } catch (e) {
    notify('error', e instanceof Error ? e.message : String(e));
  } finally {
    botGen.value = false;
  }
}

/** 采样器随模型走(与设置页同口径)。 */
const samplers = computed(() => samplersForModel(settings.nai.model));

/* 尺寸:竖/横/方常用档位合并为一个选择框;自定义历史值也会并进来 */
const SIZE_PRESETS = ['832×1216', '1216×832', '1024×1024', '896×1152', '1152×896', '768×1344', '1344×768'];
const sizeOptions = computed(() => {
  const set = new Set<string>(SIZE_PRESETS);
  set.add(settings.nai.portraitSize);
  set.add(settings.nai.landscapeSize);
  return [...set].filter(Boolean);
});

/* ---- Vibe Transfer(右侧面板;组保存栏 + 多选上传 + 单条/组导出导入) ---- */
const vibeStatus = ref('');
const vibeStatusState = ref<'' | 'success' | 'error'>('');
const vibeUploading = ref(false);
const vibeFileRef = ref<HTMLInputElement | null>(null);
const vibeImportRef = ref<HTMLInputElement | null>(null);

function setVibeStatus(text = '', state: '' | 'success' | 'error' = ''): void {
  vibeStatus.value = text;
  vibeStatusState.value = state;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 当前模型对应的本地 vibe 编码 key(V4/V4.5;其他模型 → null)。 */
const currentModelKey = computed(() => vibeLocalModelKey(settings.nai.model));

/** 当前选中的组(未选/已删 → null)。 */
const selectedGroup = computed<TlbVibeGroup | null>(
  () => settings.vibeGroups.find(g => g.id === vibeSelection.groupId) ?? null,
);

/** 当前模型编码状态徽标(四态对齐小白X:off/pending/ok)。 */
function vibeBadge(vibe: TlbVibe): { cls: string; text: string } {
  const key = currentModelKey.value;
  if (!key) return { cls: 'off', text: '模型不支持' };
  if (vibe.busy) return { cls: 'pending', text: '编码中…' };
  if (vibe.encodings[key]?.encoding) return { cls: 'ok', text: '✓ 已编码' };
  return { cls: 'pending', text: '生成时编码' };
}

/** 编码某条 vibe 为当前模型 key,写回条目并落盘;模型不支持时直接跳过。 */
async function encodeVibeNow(vibe: TlbVibe): Promise<void> {
  const key = currentModelKey.value;
  if (!key) return;
  vibe.busy = true;
  try {
    const encoding = await encodeVibeImage(vibe.image, vibe.infoExtracted);
    vibe.encodings[key] = { encoding, infoExtracted: vibe.infoExtracted };
    await updateVibe(vibe);
  } finally {
    vibe.busy = false;
  }
}

/** 拖强度即代表要用此图(对齐小白X):未启用时自动勾选;拖动过程中只即时显示,松手才落盘。 */
async function onVibeStrengthInput(vibe: TlbVibe): Promise<void> {
  if (!vibe.enabled) {
    vibe.enabled = true;
    await updateVibe(vibe);
    hintGroupEdited();
  }
}

/** 强度数值手动输入:夹回 0~1,自动勾选并落盘。 */
async function onStrengthCommit(vibe: TlbVibe): Promise<void> {
  vibe.strength = clampVibeStrength(Number.isFinite(vibe.strength) ? vibe.strength : 0);
  if (!vibe.enabled) vibe.enabled = true;
  await updateVibe(vibe);
  hintGroupEdited();
}

/**
 * 上传参考图:压缩(原图 1024 / 缩略图 256)→ 入库并勾选 → 按当前模型编码。
 * 编码失败也保留图,下次生成自动补编。
 */
async function onVibeUpload(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (!files.length || vibeUploading.value) return;
  vibeUploading.value = true;
  let lastError = false;
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setVibeStatus(`正在处理图片 ${i + 1}/${files.length}…`);
      let imageDataUrl: string;
      let thumbDataUrl: string;
      try {
        imageDataUrl = await downscaleFileToDataUrl(file, 1024, 'image/jpeg', 0.9);
        thumbDataUrl = await downscaleFileToDataUrl(file, 256, 'image/jpeg', 0.8);
      } catch (err) {
        lastError = true;
        setVibeStatus(`图片处理失败:${errMsg(err)}`, 'error');
        continue;
      }
      const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 50);
      const vibe: TlbVibe = {
        id: newId('vibe'),
        name: baseName || `Vibe ${vibeList.items.length + 1}`,
        image: imageDataUrl.slice(imageDataUrl.indexOf(',') + 1),
        thumbnail: thumbDataUrl,
        infoExtracted: 1,
        encodings: {},
        strength: 0.6,
        enabled: true,
        createdAt: Date.now(),
      };
      await addVibe(vibe);
      if (currentModelKey.value) {
        setVibeStatus(`正在编码 Vibe ${i + 1}/${files.length}(约需数秒,消耗点数)…`);
        try {
          await encodeVibeNow(vibe);
          lastError = false;
        } catch (err) {
          lastError = true;
          setVibeStatus(`编码失败:${errMsg(err)};图已入库,下次生成时自动重试`, 'error');
        }
      }
    }
    if (vibeSelection.groupId) {
      hintGroupEdited();
    } else if (!currentModelKey.value) {
      setVibeStatus('图片已入库;当前模型不支持 Vibe,切到 V4 / V4.5 后生成时自动编码', 'error');
    } else if (!lastError) {
      setVibeStatus(); /* 成功不提示:清空「正在編碼」進度列 */
    }
  } finally {
    vibeUploading.value = false;
  }
}

/** 组选中状态下手改勾选/强度只是临时改动,显式提示要 💾 覆盖或 ＋ 另存。 */
function hintGroupEdited(): void {
  const group = selectedGroup.value;
  if (group) {
    setVibeStatus(
      `当前改动不会写进组「${group.name}」:按 💾 覆盖该组、或 ＋ 另存新组后才会生效`,
      'error',
    );
  }
}

/** 勾选/强度变更:即时落盘 + 组编辑提示。 */
async function onVibeChange(vibe: TlbVibe): Promise<void> {
  await updateVibe(vibe);
  hintGroupEdited();
}

/** 信息提取变更:清空全部模型编码,立即按当前模型重编。 */
async function onInfoChange(vibe: TlbVibe): Promise<void> {
  vibe.encodings = {};
  await updateVibe(vibe);
  if (!currentModelKey.value) {
    setVibeStatus('信息提取已变更;当前模型不支持编码,切到 V4 / V4.5 后生效', 'error');
    return;
  }
  setVibeStatus('信息提取已变更,正在重新编码…');
  try {
    await encodeVibeNow(vibe);
    setVibeStatus('重新编码完成', 'success');
  } catch (err) {
    setVibeStatus(`重新编码失败:${errMsg(err)};下次生成时自动重试`, 'error');
  }
}

async function onVibeDelete(vibe: TlbVibe): Promise<void> {
  if (!window.confirm(
    `从库删除 vibe「${vibe.name}」?所有 Vibe 组里对它的引用都会失效(编码不会自动找回,需要重新花点数)。`,
  )) return;
  await removeVibe(vibe.id);
}

/* ---- 组保存栏 ---- */

async function onGroupPick(id: string | number): Promise<void> {
  const gid = String(id);
  setVibeStatus('');
  await applyVibeGroup(gid);
  if (gid) {
    const g = settings.vibeGroups.find(x => x.id === gid);
    if (g) setVibeStatus(`已套用组「${g.name}」`, 'success');
  }
}

/** ＋:把当前勾选与强度另存为新组。 */
function onGroupSaveAs(): void {
  const input = window.prompt('新 Vibe 组名称(保存当前勾选与强度):', '');
  if (input === null) return;
  const name = input.trim();
  if (!name) {
    notify('warning', '名称不能为空');
    return;
  }
  const group = saveVibeGroupAs(name);
  if (!group) {
    notify('warning', '当前没有勾选任何 Vibe,无法存组');
    return;
  }
  setVibeStatus(`已另存为新组「${group.name}」`, 'success');
}

/** 💾:有选中组 → 覆盖;未选组 → 走另存新组。 */
function onGroupSave(): void {
  if (!vibeSelection.groupId) {
    onGroupSaveAs();
    return;
  }
  const group = overwriteVibeGroup(vibeSelection.groupId);
  if (!group) {
    notify('warning', '当前没有勾选任何 Vibe,无法覆盖保存');
    return;
  }
  setVibeStatus(`组「${group.name}」已更新为当前勾选与强度`, 'success');
}

function onGroupRename(): void {
  const group = selectedGroup.value;
  if (!group) return;
  const input = window.prompt('组名称:', group.name);
  if (input === null) return;
  const name = input.trim();
  if (!name) {
    notify('warning', '名称不能为空');
    return;
  }
  renameVibeGroup(group.id, name);
}

function onGroupDelete(): void {
  const group = selectedGroup.value;
  if (!group) return;
  if (!window.confirm(`删除组「${group.name}」?组内 vibe 仍保留,勾选也不受影响。`)) return;
  deleteVibeGroup(group.id);
  setVibeStatus('组已删除', 'success');
}

/* ---- 导出 / 导入 ---- */

function safeFileName(name: string): string {
  return String(name || 'vibe').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'vibe';
}

function downloadJson(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 单条导出:官方 .naiv4vibe(带全部已编码模型)。 */
function onExportVibe(vibe: TlbVibe): void {
  downloadJson(`${safeFileName(vibe.name)}.naiv4vibe`, buildNaiv4vibe(vibe));
}

/** 组导出:小白X .vibegroup.json(含原图与编码,换机免重花点数)。 */
function onExportGroup(): void {
  const group = selectedGroup.value;
  if (!group) return;
  try {
    downloadJson(`${safeFileName(group.name)}.vibegroup.json`, buildLwbVibeGroup(group));
  } catch (err) {
    notify('error', errMsg(err));
  }
}

/**
 * 统一导入:自动识别官方 .naiv4vibe、小白X .vibe.json / .vibegroup.json。
 * 组导入时成员全部重新生成本地 id 并重建组。
 */
async function onVibeImport(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (!files.length) return;
  let singles = 0;
  let groups = 0;
  const failures: string[] = [];

  for (const file of files) {
    try {
      const parsed = parseVibeFile(await file.text());
      const ids: string[] = [];
      for (let i = 0; i < parsed.singles.length; i++) {
        const s = parsed.singles[i];
        const member = parsed.members?.[i];
        const id = newId('vibe');
        ids.push(id);
        const vibe: TlbVibe = {
          ...s,
          id,
          enabled: member ? member.enabled !== false : true,
          strength: member?.strength ?? s.strength,
          createdAt: Date.now(),
        };
        await addVibe(vibe);
      }
      if (parsed.kind === 'group') {
        const members = parsed.singles.map((_, i) => ({
          id: ids[i],
          enabled: parsed.members?.[i]?.enabled !== false,
          strength: parsed.members?.[i]?.strength ?? 0.6,
        }));
        addVibeGroup(parsed.groupName, members);
        groups++;
      } else {
        singles++;
      }
    } catch (err) {
      failures.push(`${file.name}:${errMsg(err)}`);
    }
  }

  if (singles || groups) {
    setVibeStatus(
      `已导入 ${singles} 个单个 / ${groups} 个组(编码随文件带入,无需重花点数)`,
      'success',
    );
  }
  if (failures.length) setVibeStatus(`部分文件未导入:${failures.join(';')}`, 'error');
}
</script>

<template>
  <div class="tlb-gen" :class="{ 'tlb-gen--mobile': isMobile }">
    <div class="tlb-gen__top">
      <!-- 左列:提示词区 -->
      <div class="tlb-gen__prompts">
        <!-- 画师串预设 -->
        <div>
          <label class="tlb-label">画师串预设</label>
          <div class="tlb-row tlb-gen__preset-row">
            <TlbSelect
              v-model="settings.activeArtistId"
              class="tlb-gen__preset-sel"
              :options="[{ value: '', label: '(不使用)' }, ...settings.artistPresets.map(a => ({ value: a.id, label: a.name }))]"
              @change="onArtistPick"
            />
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon" title="当前内容另存为新预设(弹窗命名)" @click="saveArtistAs"><Icon name="plus" /></button>
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon" title="保存到当前预设" :disabled="!activeArtistPreset()" @click="saveArtist"><Icon name="save" /></button>
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon" title="重新命名当前预设" :disabled="!activeArtistPreset()" @click="renameArtist"><Icon name="rename" /></button>
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon" title="删除当前预设" :disabled="!activeArtistPreset()" @click="removeArtist"><Icon name="trash" /></button>
          </div>
        </div>

        <!-- 画师串输入框 -->
        <div>
          <div class="tlb-label tlb-gen__subhead">
            <span>画师串输入框</span>
            <InputActions @copy="copyText(artistPrompt, '画师串')" @clear="clearArtist" @zoom="zoomTarget = 'artist'" />
          </div>
          <div class="tlb-fieldbox">
            <textarea
              v-model="artistPrompt"
              class="tlb-textarea"
              rows="2"
              :placeholder="artistPlaceholder"
            />
          </div>
        </div>

        <!-- 正面提示词 -->
        <div>
          <div class="tlb-label tlb-gen__cardhead">
            <span>正面提示词</span>
            <InputActions @copy="copyText(promptDraft.text, '正面提示词')" @clear="clearPrompt" @zoom="zoomTarget = 'prompt'" />
          </div>
          <div class="tlb-fieldbox">
            <textarea
              ref="promptEl"
              v-model="promptDraft.text"
              class="tlb-textarea"
              rows="3"
              placeholder="或使用自然语言描述后点击AI，让提示词助手生成协助你。"
              @keydown.meta.enter="generate"
              @keydown.ctrl.enter="generate"
            />
          </div>
          <!-- 快捷输入(左右滑动)+ 生成按钮同一行 -->
          <div class="tlb-gen__quickrow">
            <div class="tlb-gen__quick" title="点击插到光标处">
              <button
                v-for="q in usableQuickTags"
                :key="q.id"
                class="tlb-chip"
                type="button"
                :title="`插入:${q.content}`"
                @click="insertQuickTag(q.content)"
              >{{ q.title || q.content }}</button>
            </div>
            <button class="tlb-btn tlb-btn--accent tlb-btn--sm tlb-gen__gobtn" :disabled="botGen || generating" title="AI 生成:自然语言转 tag" @click="aiGenerate">
              <Icon :name="botGen ? 'loader' : 'ai'" :size="25" :spin="botGen" />
            </button>
            <button class="tlb-btn tlb-btn--accent tlb-btn--sm tlb-gen__gobtn" :disabled="generating" title="NAI 生成:出图(Cmd/Ctrl+Enter)" @click="generate">
              <Icon :name="generating ? 'loader' : 'wand-sparkles'" :spin="generating" />
            </button>
          </div>
        </div>

        <!-- 负面提示词(默认折叠):标题样式同正面提示词,箭头在标题之后 -->
        <div class="tlb-gen__negative">
          <div
            class="tlb-label tlb-gen__negtoggle"
            role="button"
            tabindex="0"
            title="展开/收起负面提示词"
            @click="showNegative = !showNegative"
            @keydown.enter="showNegative = !showNegative"
            @keydown.space.prevent="showNegative = !showNegative"
          >
            负面提示词
            <span class="tlb-hint">（覆写；留空 = 官方默认）</span>
            <Icon class="tlb-gen__negarrow" :class="{ 'tlb-gen__negarrow--closed': !showNegative }" name="chevron-down" />
          </div>
          <div v-if="showNegative" class="tlb-fieldbox tlb-gen__negbox">
            <textarea v-model="settings.nai.undesiredContent" class="tlb-textarea" rows="2" placeholder="留空 = 按模型取官方负面词" />
            <button
              class="tlb-btn tlb-btn--bare tlb-gen__negzoom"
              type="button"
              title="放大"
              @click="zoomTarget = 'negative'"
            ><Icon name="maximize" /></button>
          </div>
        </div>

        <p v-if="status && !error" class="tlb-hint">{{ status }}</p>
        <p v-if="error" class="tlb-gen__error">{{ error }}</p>
        <p v-if="!activeEndpoint().key" class="tlb-hint">未配置 API Key:到「设置」填写,或点「从柏宝绘同步」。</p>
      </div>

      <!-- 右列:Vibe Transfer + 生图参数(直连生效;可单独勾选或多勾选) -->
      <aside class="tlb-gen__side">
       <div class="tlb-vibe">
        <div class="tlb-row tlb-vibe__head">
          <h3 class="tlb-vibe__title">
            Vibe 氛围转移
            <span class="tlb-vibe__tip" tabindex="0">
              <Icon name="info" />
              <span class="tlb-vibe__tip-body">
                <span class="tlb-vibe__tip-lead">上传参考图把画风 / 构图 / 色彩迁移到生成结果。两种用法：</span>
                <span><b>① 直接勾选：</b>勾选即时生效，生成时叠加；缺编码会在生成前自动补（花点数）。</span>
                <span><b>② Vibe 组：</b>勾选后用 💾 存成 Vibe 组，下拉选组一键整体套用；之后 💾 覆盖改组，所有引用一起更新。</span>
              </span>
            </span>
          </h3>
        </div>

        <!-- 组保存栏:高度/圆角/间距与画师串预设行完全一致(gap 5、select/钮 26px) -->
        <div class="tlb-row tlb-vibe__groupbar">
          <TlbSelect
            class="tlb-vibe__groupselect"
            :model-value="vibeSelection.groupId"
            :options="[{ value: '', label: '— Vibe 组 —' }, ...settings.vibeGroups.map(g => ({ value: g.id, label: `${g.name}（${g.members.length} 张）` }))]"
            @change="onGroupPick"
          />
          <div class="tlb-vibe__groupbtns">
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon tlb-vibe__groupbtn" type="button" title="把当前勾选与强度另存为新 Vibe 组" @click="onGroupSaveAs"><Icon name="plus" :size="16" /></button>
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon tlb-vibe__groupbtn" type="button" :disabled="!selectedGroup" title="重命名当前组" @click="onGroupRename"><Icon name="edit" :size="15" /></button>
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon tlb-vibe__groupbtn" type="button" :title="vibeSelection.groupId ? '覆盖保存当前组' : '另存为新组'" @click="onGroupSave"><Icon name="save" :size="15" /></button>
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon tlb-vibe__groupbtn tlb-vibe__groupbtn--danger" type="button" :disabled="!selectedGroup" title="删除当前组" @click="onGroupDelete"><Icon name="trash" :size="15" /></button>
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon tlb-vibe__groupbtn" type="button" :disabled="!selectedGroup" title="导出当前组" @click="onExportGroup"><Icon name="file-export" :size="16" /></button>
            <label class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon tlb-vibe__groupbtn" title="导入 Vibe / 组文件">
              <Icon name="file-import" :size="16" />
              <input
                ref="vibeImportRef"
                type="file"
                multiple
                accept=".naiv4vibe,.vibe.json,.vibegroup.json,.json,application/json"
                hidden
                @change="onVibeImport"
              />
            </label>
          </div>
        </div>

        <div class="tlb-vibe__list">
          <button
            class="tlb-vibe__upload"
            :class="{ 'tlb-vibe__upload--fill': vibeList.loaded && !vibeList.items.length }"
            type="button"
            :disabled="vibeUploading"
            @click="vibeFileRef?.click()"
          >
            <Icon :name="vibeUploading ? 'loader' : 'cloud-up'" :size="17" :spin="vibeUploading" />
            <span>{{ vibeUploading ? '正在处理…' : '上传参考图（编码花点数，仅 NAI V4 / V4.5 支持）' }}</span>
          </button>
          <input
            ref="vibeFileRef"
            type="file"
            accept="image/*"
            multiple
            hidden
            @change="onVibeUpload"
          />

          <div
            v-for="v in vibeList.items"
            :key="v.id"
            class="tlb-vibe__item"
            :class="{ 'is-disabled': !v.enabled, 'is-busy': v.busy }"
          >
            <input
              v-model="v.enabled"
              class="tlb-vibe__enable"
              type="checkbox"
              title="勾选后此参考图才参与生成"
              @change="onVibeChange(v)"
            />
            <img class="tlb-vibe__thumbimg" :src="v.thumbnail || (v.image ? `data:image/jpeg;base64,${v.image}` : '')" :alt="v.name" />
            <div class="tlb-vibe__main">
              <div class="tlb-vibe__name" :title="v.name">{{ v.name }}</div>
              <div class="tlb-vibe__row">
                <label>强度</label>
                <input
                  v-model.number="v.strength"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  @input="onVibeStrengthInput(v)"
                  @change="onVibeChange(v)"
                />
                <input
                  v-model.number="v.strength"
                  class="tlb-vibe__val tlb-vibe__val-input"
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  title="可直接输入 0~1,回车/失焦生效"
                  @change="onStrengthCommit(v)"
                />
              </div>
              <div class="tlb-vibe__row tlb-vibe__info-row">
                <TlbSelect
                  v-model="v.infoExtracted"
                  class="tlb-vibe__info-sel"
                  :disabled="v.busy"
                  title="信息提取(改了要重新花点数编码)"
                  :options="[{ value: 1, label: '高·构图' }, { value: 0, label: '低·色彩' }]"
                  @change="onInfoChange(v)"
                />
                <span class="tlb-vibe__badge" :class="`tlb-vibe__badge--${vibeBadge(v).cls}`">{{ vibeBadge(v).text }}</span>
                <span class="tlb-vibe__iconpair">
                  <button class="tlb-vibe__iconbtn" type="button" title="导出此 Vibe(.naiv4vibe,含原图与各模型编码)" @click="onExportVibe(v)"><Icon name="file-export" :size="14" /></button>
                  <button class="tlb-vibe__iconbtn tlb-vibe__iconbtn--danger" type="button" title="从库删除(所有组里的引用都会失效)" @click="onVibeDelete(v)"><Icon name="close" :size="14" /></button>
                </span>
              </div>
            </div>
          </div>
          <p v-if="!vibeList.items.length && !vibeList.loaded" class="tlb-vibe__empty">加载中…</p>
        </div>

        <div v-if="vibeStatus" class="tlb-vibe__status" :class="`tlb-vibe__status--${vibeStatusState}`">
          <Icon :name="vibeStatusState === 'error' ? 'warning' : 'check'" :size="13" />
          {{ vibeStatus }}
        </div>
       </div>

       <!-- 生图参数(默认折叠;与设置页同一份 settings.nai) -->
       <div class="tlb-gen__sidecard">
        <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-gen__sidecard-head" @click="showParams = !showParams">
          <Icon :name="showParams ? 'chevron-down' : 'chevron-right'" />
          生图参数
          <span class="tlb-hint tlb-gen__sidecard-sub">{{ settings.nai.model }} · {{ settings.nai.portraitSize }}</span>
        </button>
        <div v-if="showParams" class="tlb-gen__params">
          <div class="tlb-gen__pgrid">
            <label class="tlb-gen__pfield tlb-gen__pmodel">
              <span class="tlb-label">模型</span>
              <TlbSelect v-model="settings.nai.model" :options="NAI_MODELS" />
            </label>
            <div class="tlb-gen__prow tlb-gen__prow--3">
              <label class="tlb-gen__pfield">
                <span class="tlb-label">采样器</span>
                <TlbSelect v-model="settings.nai.sampler" :options="samplers" />
              </label>
              <label class="tlb-gen__pfield">
                <span class="tlb-label">噪声表</span>
                <TlbSelect v-model="settings.nai.noiseSchedule" :options="NAI_NOISE_SCHEDULES" />
              </label>
              <label class="tlb-gen__pcheck" title="Variety Boost">
                <input v-model="settings.nai.varietyBoost" class="tlb-checkbox" type="checkbox" />
                Variety Boost
              </label>
            </div>
            <div class="tlb-gen__prow tlb-gen__prow--3">
              <label class="tlb-gen__pfield">
                <span class="tlb-label">步数</span>
                <input v-model.number="settings.nai.steps" class="tlb-input" type="number" min="1" max="50" />
              </label>
              <label class="tlb-gen__pfield">
                <span class="tlb-label">CFG</span>
                <input v-model.number="settings.nai.scale" class="tlb-input" type="number" min="0" max="10" step="0.1" />
              </label>
              <label class="tlb-gen__pfield">
                <span class="tlb-label">残差</span>
                <input v-model.number="settings.nai.cfgRescale" class="tlb-input" type="number" min="0" max="1" step="0.05" />
              </label>
            </div>
            <div class="tlb-gen__prow tlb-gen__prow--2">
              <label class="tlb-gen__pfield">
                <span class="tlb-label">尺寸</span>
                <TlbSelect
                  v-model="settings.nai.portraitSize"
                  title="生成图片尺寸"
                  :options="sizeOptions.map(s => ({ value: s, label: s }))"
                />
              </label>
              <label class="tlb-gen__pfield">
                <span class="tlb-label">种子 <span class="tlb-hint">(0=随机)</span></span>
                <input v-model.number="settings.nai.seed" class="tlb-input" type="number" min="0" />
              </label>
            </div>
          </div>
        </div>
       </div>
      </aside>
    </div>

    <!-- 图片大图:滑动切换 + 点击图片本身放大 -->
    <div
      ref="previewEl"
      class="tlb-gen__preview"
      @pointerdown="onSwipeDown"
      @pointermove="onSwipeMove"
      @pointerup="onSwipeUp"
      @pointercancel="onSwipeUp"
      @click="onPreviewClick"
    >
      <img v-if="currentUrl" :src="currentUrl" alt="" draggable="false" title="点击放大" />
      <div v-else class="tlb-gen__empty">
        <Icon name="image" />
        <p>还没有图片。快点写提示词去生成吧！</p>
      </div>

      <template v-if="history.items.length > 1">
        <button class="tlb-gen__nav tlb-gen__nav--l" title="上一张(更新)" @click.stop="stepSelection(-1)">
          <Icon name="chevron-left" />
        </button>
        <button class="tlb-gen__nav tlb-gen__nav--r" title="下一张(更旧)" @click.stop="stepSelection(1)">
          <Icon name="chevron-right" />
        </button>
      </template>

      <span v-if="current" class="tlb-gen__badge">
        {{ current.width }}×{{ current.height }} · seed {{ current.seed }}
      </span>
    </div>

    <!-- 放大输入框(画师串/正面词/负面词共用) -->
    <div v-if="zoomTarget" ref="zoomBackdropEl" class="tlb-modal-backdrop" @click.self="zoomTarget = null">
      <div class="tlb-modal-stage" :style="zoomAnchorStyle">
      <div class="tlb-modal" role="dialog" aria-modal="true" :aria-label="`放大编辑${ZOOM_TITLES[zoomTarget]}`">
        <div class="tlb-modal__head">
          <b>{{ ZOOM_TITLES[zoomTarget] }}</b>
          <span class="tlb-grow" />
          <button class="tlb-btn tlb-btn--bare tlb-btn--sm tlb-btn--icon" title="关闭" @click="zoomTarget = null"><Icon name="close" /></button>
        </div>
        <textarea
          v-model="zoomText"
          class="tlb-modal__ta tlb-textarea"
          placeholder="使用自然语让 AI 生成提示词,或直接输入英文 tag"
        ></textarea>
        <div class="tlb-modal__foot">
          <button class="tlb-btn tlb-btn--accent" @click="zoomTarget = null">完成</button>
        </div>
      </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tlb-gen {
  display: flex;
  flex-direction: column;
  gap: 11px; /* 區域間距(原 10px,+10%) */
  padding: 10px 0;
}

.tlb-gen__top {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  align-items: start;
  flex: none;
}

.tlb-gen__top > * {
  min-width: 0; /* 防止 chips/长串把网格列撑爆,挤掉右列 vibe 区 */
}

.tlb-gen__prompts {
  display: flex;
  flex-direction: column;
  gap: 9px; /* 各區(預設/畫師串/角色/正面詞/負面詞)間距,原 8px,+10% */
  min-width: 0;
}

/* 输入框右上角悬浮的操作群组(复制/清空/放大):所有输入框共用。
   悬浮条 hover/聚焦才浮现(见 InputActions.vue),文字可铺满,不再常驻留白。 */
.tlb-fieldbox {
  position: relative;
}

/* 操作鈕移進標題列後,以標題列為錨點 */
.tlb-gen__subhead,
.tlb-gen__cardhead {
  position: relative;
}

/* 負面詞:僅保留單顆懸浮半透明放大鈕(右上角內縮,避免貼邊被裁切),hover/聚焦浮現 */
.tlb-gen__negzoom {
  position: absolute;
  right: 10px;
  top: 10px;
  z-index: 2;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: var(--tlb-radius-pill);
  background: color-mix(in srgb, var(--tlb-ink) 18%, transparent);
  color: #fff;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--tlb-dur) var(--tlb-ease) 0.2s, background var(--tlb-dur) var(--tlb-ease);
}

.tlb-gen__negbox:hover .tlb-gen__negzoom,
.tlb-gen__negbox:focus-within .tlb-gen__negzoom {
  opacity: 1;
  pointer-events: auto;
  transition-delay: 0s;
}

.tlb-gen__negzoom:hover {
  background: color-mix(in srgb, var(--tlb-ink) 38%, transparent);
}

/* 画师串预设:下拉框占一半,四个符号钮在另一半 */
/* 左列变窄后,保证下拉(约半行)+4 个图标按钮不溢出到右列 */
.tlb-gen__preset-row {
  gap: 5px;
}

.tlb-gen__preset-row .tlb-btn--icon {
  width: 26px;
  height: 26px;
}

.tlb-gen__preset-sel {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  height: 26px; /* 跟随保存按钮(26px)高度;拉长到与按钮列只隔一个 row gap */
}

/* 右列:vibe + 生图参数 */
.tlb-gen__side {
  display: flex;
  flex-direction: column;
  gap: 11px; /* vibe 卡片 / 生圖參數卡片之間,原 10px,+10% */
  min-width: 0;
}

/* 负面提示词标题:与「正面提示词」同款纯文字 label,无按钮底色;点击整行折叠 */
.tlb-gen__negtoggle {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px; /* 与正面提示词 label 一致 */
  cursor: pointer;
  user-select: none;
}

.tlb-gen__negtoggle:focus-visible {
  outline: 2px solid var(--tlb-accent);
  outline-offset: 2px;
  border-radius: var(--tlb-radius-sm);
}

/* 向下箭头:折叠时向左旋转 90°(始终是同一个下箭头,不引入左箭头) */
.tlb-gen__negarrow {
  font-size: 14px;
  transition: transform var(--tlb-dur) var(--tlb-ease);
}

.tlb-gen__negarrow--closed {
  transform: rotate(-90deg);
}

/* 生图参数卡片 */
.tlb-gen__sidecard {
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius);
  background: var(--tlb-surface);
  overflow: hidden;
}

.tlb-gen__sidecard-head {
  width: 100%;
  justify-content: flex-start;
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 8px 12px;
}

.tlb-gen__sidecard-head:hover:not(:disabled) {
  border: none;
  background: var(--tlb-surface-2);
}

.tlb-gen__sidecard-sub {
  margin-left: auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tlb-gen__params {
  padding: 10px 12px 12px;
  border-top: 1px solid var(--tlb-line);
}

.tlb-gen__pgrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 10px;
}

/* 模型独占一行 */
.tlb-gen__pmodel {
  grid-column: 1 / -1;
}

/* 行内多列:步数/CFG/残差、尺寸/种子 */
.tlb-gen__prow {
  grid-column: 1 / -1;
  display: grid;
  gap: 8px;
  min-width: 0;
}

.tlb-gen__prow--2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.tlb-gen__prow--3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.tlb-gen__pfield {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.tlb-gen__pcheck {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  align-self: end;
  height: 28px; /* 与同行的采样器/噪声表下拉框对齐 */
  gap: 6px;
  font-size: 12.5px;
  color: var(--tlb-ink-soft);
}

.tlb-gen__error {
  color: var(--tlb-danger);
  font-size: 12.5px;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 快捷输入:左右滑动(滚动条隐藏)+ 生成符号钮同一行 */
.tlb-gen__quickrow {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  min-width: 0;
}

.tlb-gen__quick {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.tlb-gen__quick::-webkit-scrollbar {
  display: none;
}

.tlb-gen__gobtn {
  flex: none;
  width: 34px;
  height: 30px;
  padding: 0;
  color: #fff; /* AI/NAI 生成图标固定白色 */
}

.tlb-chip {
  flex: none;
  border: 1px solid transparent;
  background: color-mix(in srgb, var(--tlb-ink) 7%, transparent);
  color: var(--tlb-ink-soft);
  border-radius: var(--tlb-radius-pill);
  padding: 0 8px;
  font-size: 10.5px;
  line-height: 1.7;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color var(--tlb-dur) var(--tlb-ease);
}

.tlb-chip:hover {
  border-color: var(--tlb-accent);
}

/* 放大输入框模态 */
.tlb-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10020;
  background: rgba(0, 0, 0, 0.45);
}

/* 對齊浮動面板實測矩形的置中容器(視窗縮放不偏移) */
.tlb-modal-stage {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
}

.tlb-modal {
  width: min(720px, 100%);
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--tlb-surface);
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
  overflow: hidden;
}

.tlb-modal__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--tlb-line);
}

.tlb-modal__ta {
  flex: 1;
  min-height: 320px;
  margin: 0;
  border: none;
  border-radius: 0;
  resize: none;
  padding: 14px;
  font-size: 14px;
  line-height: 1.7;
}

.tlb-modal__foot {
  display: flex;
  justify-content: flex-end;
  padding: 10px 14px;
  border-top: 1px solid var(--tlb-line);
}

.tlb-gen__preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  min-height: 340px;
  max-height: 60vh;
  border-radius: var(--tlb-radius);
  background: var(--tlb-surface-2);
  border: 1px solid var(--tlb-line);
  overflow: hidden;
  touch-action: pan-y;
  user-select: none;
}

.tlb-gen__preview img {
  max-width: 100%;
  max-height: 60vh;
  object-fit: contain;
  cursor: zoom-in;
}

.tlb-gen__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--tlb-ink-muted);
  padding: 40px 0;
}

.tlb-gen__empty .tlb-icon {
  font-size: 32px;
  opacity: 0.55;
}

.tlb-gen__nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
  width: 26px;
  height: 26px;
  font-size: 11px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: var(--tlb-radius-pill);
  background: rgba(0, 0, 0, 0.38);
  color: #fff;
  cursor: pointer;
  opacity: 0.85;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--tlb-dur) var(--tlb-ease), opacity var(--tlb-dur) var(--tlb-ease);
}

.tlb-gen__nav:hover {
  background: rgba(0, 0, 0, 0.6);
  opacity: 1;
}

.tlb-gen__nav--l {
  left: 8px;
}

.tlb-gen__nav--r {
  right: 8px;
}

.tlb-gen__badge {
  position: absolute;
  bottom: 8px;
  left: 10px;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: var(--tlb-radius-pill);
  background: var(--tlb-overlay);
  color: #fff;
}

/* ═══ Vibe 氛围转移:卡片外壳沿用 .tlb-vibe,内部结构 1:1 对齐小白X nd-vibe-* ═══ */
.tlb-vibe {
  min-width: 0;
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius);
  background: var(--tlb-surface);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.tlb-vibe__head {
  padding: 10px 12px;
  border-bottom: 1px solid var(--tlb-line);
}

.tlb-vibe__title {
  position: relative; /* ⓘ 浮层以标题为定位锚点 */
  margin: 0;
  font-size: 12.5px; /* 跟随 .tlb-label */
  font-weight: 600;
  color: var(--tlb-ink-soft);
}

/* 标题旁 ⓘ 用法说明:hover/focus 展开 280px 浮层 */
.tlb-vibe__tip {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  color: var(--tlb-ink-muted);
  font-weight: normal;
  cursor: help;
  outline: none;
  vertical-align: middle;
}

.tlb-vibe__tip:hover,
.tlb-vibe__tip:focus {
  color: var(--tlb-ink);
}

.tlb-vibe__tip-body {
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
  flex-direction: column;
  gap: 6px;
}

.tlb-vibe__tip-body b {
  color: var(--tlb-ink);
  font-weight: 600;
}

.tlb-vibe__tip:hover .tlb-vibe__tip-body,
.tlb-vibe__tip:focus .tlb-vibe__tip-body,
.tlb-vibe__tip:focus-within .tlb-vibe__tip-body {
  display: flex;
}

/* ---- 组保存栏:规格与画师串预设行(.tlb-gen__preset-row)逐像素一致:gap 5、26px 高、8px 圆角 ---- */
.tlb-vibe__groupbar {
  gap: 5px;
  padding: 10px 12px 0;
}

.tlb-vibe__groupselect {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  width: auto;
  height: 26px; /* 跟随画师串预设下拉 */
}

.tlb-vibe__groupbtns {
  flex: none;
  display: flex;
  gap: 5px;
}

/* 按钮本体沿用全局 .tlb-btn--ghost--sm--icon;这里只收窄到 26×26(同画师串预设) */
.tlb-vibe__groupbar .tlb-btn--icon {
  width: 26px;
  height: 26px;
}

.tlb-vibe__groupbtn--danger:hover:not(:disabled) {
  background: var(--tlb-danger);
  border-color: transparent;
  color: #fff;
}

label.tlb-vibe__groupbtn {
  cursor: pointer;
}

/* ---- 列表(预留区:26vh 固定高,原 29vh 下调约 10%;底部多留 12px,上传砖不贴卡片底) ---- */
.tlb-vibe__list {
  height: 26vh;
  overflow-y: auto;
  padding: 10px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 上传砖:1.5px 虚线、radius 10、cloud-up 图标;
   有 vibe 时保持自然高度,空库时 --fill 纵向撑满整个列表区(有 vibe 后自动挤回去) */
.tlb-vibe__upload {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  border: 1.5px dashed var(--tlb-line);
  border-radius: 10px;
  background: transparent;
  color: var(--tlb-ink-muted);
  font-size: 12px;
  padding: 14px 12px;
  cursor: pointer;
}

.tlb-vibe__upload--fill {
  flex: 1 1 auto;
  min-height: 120px;
}

.tlb-vibe__upload:hover:not(:disabled) {
  border-color: var(--tlb-accent);
  color: var(--tlb-ink);
}

.tlb-vibe__upload:disabled {
  opacity: 0.7;
  cursor: wait;
}

/* 条目:左勾选 + 48×64 缩略图 + main + 右侧两个图标钮 */
.tlb-vibe__item {
  display: flex;
  gap: 10px;
  padding: 8px;
  border: 1px solid var(--tlb-line);
  border-radius: 10px;
  background: var(--tlb-surface-2);
  align-items: flex-start;
}

.tlb-vibe__item.is-disabled {
  opacity: 0.5;
}

.tlb-vibe__item.is-busy {
  opacity: 0.7;
}

.tlb-vibe__enable {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  align-self: center;
  cursor: pointer;
  accent-color: var(--tlb-accent);
}

.tlb-vibe__thumbimg {
  width: 48px;
  height: 64px;
  object-fit: cover;
  border-radius: 6px;
  flex-shrink: 0;
  background: rgba(0, 0, 0, 0.25);
}

.tlb-vibe__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tlb-vibe__name {
  font-size: 12px;
  font-weight: 600;
  color: var(--tlb-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tlb-vibe__row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.tlb-vibe__row label {
  color: var(--tlb-ink-muted);
  flex-shrink: 0;
}

.tlb-vibe__row input[type='range'] {
  flex: 1;
  min-width: 0;
  accent-color: #3b82f6;
}

.tlb-vibe__val {
  width: 46px;
  text-align: right;
  color: var(--tlb-ink);
  flex-shrink: 0;
}

/* 强度数值:可手输的 number 框(外观与普通值一致,聚焦才有边框) */
.tlb-vibe__val-input {
  padding: 2px 4px;
  font-size: 12px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  font-family: inherit;
}

.tlb-vibe__val-input:hover {
  border-color: var(--tlb-line);
}

.tlb-vibe__val-input:focus {
  outline: none;
  border-color: var(--tlb-accent);
  background: var(--tlb-surface);
}

/* 隐藏 number 框上下箭头(拖滑杆即可,输入也不受影响) */
.tlb-vibe__val-input::-webkit-outer-spin-button,
.tlb-vibe__val-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.tlb-vibe__val-input {
  -moz-appearance: textfield;
  appearance: textfield;
}

.tlb-vibe__info-row {
  gap: 6px;
}

/* 徽标连同右侧按钮组整体靠右(信息提取下拉留在最左) */
.tlb-vibe__info-row > .tlb-vibe__badge {
  margin-left: auto;
}

/* 导出/删除紧挨在一起(间隔小于行内其它元素) */
.tlb-vibe__iconpair {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.tlb-vibe__info-sel {
  max-width: 110px;
  min-height: 0; /* 22px 小尺寸下拉 */
}

/* 编码状态徽标:主题色=已编码 / 黄=待编码 / 灰=不支持 */
.tlb-vibe__badge {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  line-height: 1.4;
  padding: 2px 7px;
  border-radius: 999px;
  white-space: nowrap;
  flex-shrink: 0;
}

.tlb-vibe__badge--ok {
  background: var(--tlb-accent-soft);
  color: var(--tlb-accent);
}

.tlb-vibe__badge--pending {
  background: rgba(210, 153, 34, 0.18);
  color: #e0a93e;
}

.tlb-vibe__badge--off {
  background: rgba(160, 160, 160, 0.15);
  color: var(--tlb-ink-muted);
}

/* 行内图标钮:导出 / 删除(在信息度行内垂直居中) */
.tlb-vibe__iconbtn {
  width: 26px;
  height: 26px;
  margin-top: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--tlb-ink-muted);
  cursor: pointer;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.tlb-vibe__iconbtn:hover {
  background: var(--tlb-accent-soft);
  color: var(--tlb-ink);
}

.tlb-vibe__iconbtn--danger:hover {
  background: var(--tlb-danger);
  color: #fff;
}

/* 空库占位 */
.tlb-vibe__empty {
  text-align: center;
  line-height: 1.7;
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  min-height: 140px;
  border: 1px dashed var(--tlb-line);
  border-radius: 10px;
  color: var(--tlb-ink-muted);
}

/* ---- 底部状态栏(对齐 .status-text) ---- */
.tlb-vibe__status {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid var(--tlb-line);
  font-size: 12px;
  line-height: 1.5;
  min-height: 18px;
  color: var(--tlb-ink-muted);
}

.tlb-vibe__status .tlb-icon {
  flex: none;
  margin-top: 2px;
}

.tlb-vibe__status--success {
  color: var(--tlb-accent);
}

.tlb-vibe__status--error {
  color: var(--tlb-danger);
}

/* —— 移動端:主 grid 改單列,避免左右硬塞造成文字折行/按鈕裁切(即回報的「塌陷」) ——
   由 JS isMobile 類驅動,不用 @media:安卓 ST 網頁版桌面模式 viewport≈980 會漏接斷點。 */
.tlb-gen--mobile .tlb-gen__top {
  grid-template-columns: 1fr;
  gap: 11px;
}

/* Vibe 組列:下拉整行,6 顆按鈕獨立一行並可橫滑,不再被視口裁切 */
.tlb-gen--mobile .tlb-vibe__groupbar {
  flex-wrap: wrap;
}
.tlb-gen--mobile .tlb-vibe__groupselect {
  flex: 1 1 100%;
}
.tlb-gen--mobile .tlb-vibe__groupbtns {
  flex: 1 1 100%;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.tlb-gen--mobile .tlb-vibe__groupbtns::-webkit-scrollbar {
  display: none;
}
.tlb-gen--mobile .tlb-vibe__groupbtn {
  flex: none;
}

/* 預覽框窄屏少占縱向空間 */
.tlb-gen--mobile .tlb-gen__preview {
  min-height: 220px;
}

/* 快捷 tag:窄屏不壓字,標籤固定寬度整排橫滑,AI/生圖鈕不縮 */
.tlb-gen--mobile .tlb-gen__quick {
  flex: 1 1 0;
}
.tlb-gen--mobile .tlb-gen__quick .tlb-chip {
  flex: none;
}
.tlb-gen--mobile .tlb-gen__gobtn {
  flex: none;
}

/* 生圖參數:3 列/2 列在 ≤~380px 寬度下每格不足 100px,統一改單列 */
.tlb-gen--mobile .tlb-gen__pgrid,
.tlb-gen--mobile .tlb-gen__prow--2,
.tlb-gen--mobile .tlb-gen__prow--3 {
  grid-template-columns: 1fr;
}
</style>