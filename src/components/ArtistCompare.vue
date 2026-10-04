<script setup lang="ts">
/**
 * 画师库页(原「多画师串对比」页)—— 定位为次要的画师资料管理。
 *
 * 交互对齐画廊(GalleryPanel):
 * - view(默认):hover 卡片显示 导出 / 删除;
 * - batch(批量管理):点卡片任意位置切换选中,工具栏 全选 / 导出选中 / 删除(两步确认);
 * - compare(生成对比):点卡片选取,无数量上限;开始后顺序生成、共用种子,
 *   每张之间按 settings.compareInterval 的秒数范围随机等待防风控。
 * 运行态在 compareRun 单例里,切 tab / 组件重挂不丢进度。
 * 布局:上(画师卡片网格)下(对比结果网格),中间分隔条可拖动,双击复位。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue';

import Icon from '@/components/Icon.vue';
import { parseResolution } from '@/constants';
import { artistPreviews } from '@/state/artistPreviews';
import { clearCompareResults, compareRun, startCompareRun, stopCompareRun } from '@/state/compareRun';
import type { CompareRunRow } from '@/state/compareRun';
import { history, loadHistory } from '@/state/historyList';
import { artistStore, selectArtist, settings } from '@/state/settings';
import { imageUrl, ui } from '@/state/ui';
import { loadVibes, vibeList } from '@/state/vibeList';
import { exportArtists } from '@/sync/exportBundle';
import { notify } from '@/st/toast';
import { usePanelAnchor } from '@/use/panelAnchor';
import { useIsMobile } from '@/use/useIsMobile';
import type { TlbArtistPreset, TlbHistoryMeta } from '@/types';

const isMobile = useIsMobile();

type LibMode = 'view' | 'batch' | 'compare';

const mode = ref<LibMode>('view');
const selected = ref<string[]>([]);
const picking = computed(() => mode.value !== 'view');
const isSelected = (id: string): boolean => selected.value.includes(id);

/* ═══ 搜索画师名:纯前端过滤显示,不影响已选集合(可跨多次搜索累加选取) ═══ */
const searchQuery = ref('');
const filteredPresets = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return settings.artistPresets;
  return settings.artistPresets.filter(a => a.name.toLowerCase().includes(q));
});

onMounted(() => {
  if (!history.loaded) void loadHistory();
});

/* ═══ 预览图:同步导入优先,历史最新一张兜底(与旧对比页同口径) ═══ */

const fullUrls = reactive<Record<string, string>>({});

watch(
  () => history.items,
  async items => {
    for (const it of items) {
      if (it.artistId && !it.thumb && !fullUrls[it.id]) {
        const u = await imageUrl(it.id);
        if (u) fullUrls[it.id] = u;
      }
    }
  },
  { immediate: true, deep: true },
);

/** 某预设的最近一张生成记录(无 = 没预览图)。 */
function previewOf(presetId: string): TlbHistoryMeta | undefined {
  return history.items.find(it => it.artistId === presetId);
}

/** 预览图地址:同步导入的预览图优先,其次历史缩略图,旧记录回落全图;空串 = 无预览图。 */
function previewSrc(presetId: string): string {
  if (artistPreviews[presetId]) return artistPreviews[presetId];
  const p = previewOf(presetId);
  return p ? p.thumb || fullUrls[p.id] || '' : '';
}

/* ═══ 模式切换 ═══ */

function enterMode(next: LibMode): void {
  if (mode.value === next) return;
  mode.value = next;
  selected.value = [];
  searchQuery.value = '';
  confirmDeleteOpen.value = false;
}

function exitMode(): void {
  mode.value = 'view';
  selected.value = [];
  searchQuery.value = '';
  confirmDeleteOpen.value = false;
}

/* ═══ 点卡片 / 全选 ═══ */

function onCardClick(a: TlbArtistPreset): void {
  /* 浏览态:点卡片 = 在「生成」页选中该画师并跳过去(与画师串下拉同源) */
  if (!picking.value) {
    selectArtist(a.id);
    ui.tab = 'gen';
    notify('success', `已在生成页选择画师串「${a.name}」`);
    return;
  }
  if (isSelected(a.id)) selected.value = selected.value.filter(x => x !== a.id);
  else selected.value.push(a.id);
  confirmDeleteOpen.value = false;
}

/* 全选口径 = 当前搜索后可见的结果(与网格同源,避免「全选」与所见不一致) */
const isAllSelected = computed(
  () =>
    filteredPresets.value.length > 0 &&
    filteredPresets.value.every(a => selected.value.includes(a.id)),
);

function toggleAll(): void {
  if (isAllSelected.value) {
    // 仅取消可见项的选中,搜索过滤掉的(不可见)选中保留
    const visible = new Set(filteredPresets.value.map(a => a.id));
    selected.value = selected.value.filter(id => !visible.has(id));
  } else {
    const set = new Set(selected.value);
    for (const a of filteredPresets.value) set.add(a.id);
    selected.value = [...set];
  }
}

/* ═══ 删除 ═══ */

function removeOne(id: string): void {
  artistStore.remove(id);
  selected.value = selected.value.filter(x => x !== id);
}

const confirmDeleteOpen = ref(false);

/** 卡片內聯二次確認:記錄待刪畫師 id */
const cardConfirmId = ref<string | null>(null);

function askCardDelete(id: string): void {
  cardConfirmId.value = id;
}

function cancelCardDelete(): void {
  cardConfirmId.value = null;
}

function confirmCardDelete(): void {
  if (cardConfirmId.value) removeOne(cardConfirmId.value);
  cardConfirmId.value = null;
}

function askBatchDelete(): void {
  if (selected.value.length) confirmDeleteOpen.value = true;
}

function batchDelete(): void {
  const ids = [...selected.value];
  confirmDeleteOpen.value = false;
  for (const id of ids) artistStore.remove(id);
  selected.value = [];
  notify('success', `已删除 ${ids.length} 位画师`);
}

/* ═══ 导出:先弹 vibe 选择 ═══ */

const picker = reactive({ open: false, presetIds: [] as string[], vibeIds: [] as string[] });

const { backdropEl: pickerBackdropEl, anchorStyle: pickerAnchorStyle } = usePanelAnchor(
  computed(() => picker.open),
);

async function askExport(presetIds: string[]): Promise<void> {
  if (!presetIds.length) return;
  if (!vibeList.loaded) await loadVibes();
  picker.presetIds = presetIds;
  picker.vibeIds = [];
  picker.open = true;
}

const pickerAll = computed(
  () => vibeList.items.length > 0 && picker.vibeIds.length === vibeList.items.length,
);

function pickerToggleAll(): void {
  picker.vibeIds = pickerAll.value ? [] : vibeList.items.map(v => v.id);
}

async function confirmExport(): Promise<void> {
  const presetIds = [...picker.presetIds];
  const vibeIds = [...picker.vibeIds];
  picker.open = false;
  await exportArtists(presetIds, vibeIds);
  const firstName = settings.artistPresets.find(a => a.id === presetIds[0])?.name ?? '';
  notify(
    'success',
    presetIds.length > 1 ? `已导出 ${presetIds.length} 位画师的资料包` : `已导出「${firstName}」资料包`,
  );
}

/* ═══ 生成对比 ═══ */

function startRun(): void {
  const ids = [...selected.value];
  // startCompareRun 校验通过时会在首个 await 前同步把 running 置 true
  void startCompareRun(ids);
  if (compareRun.running) exitMode();
}

const doneCount = computed(() => compareRun.rows.filter(r => r.status === 'done').length);

/* ═══ 间隔秒数输入(0–60) ═══ */

function numFromEvent(e: Event): number {
  return Number((e.target as HTMLInputElement).value);
}

function setIntervalMin(v: number): void {
  let n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 10;
  n = Math.min(60, Math.max(0, n));
  settings.compareInterval.minSec = n;
  if (n > settings.compareInterval.maxSec) settings.compareInterval.maxSec = n;
}

function setIntervalMax(v: number): void {
  let n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 30;
  n = Math.min(60, Math.max(0, n));
  settings.compareInterval.maxSec = n;
  if (n < settings.compareInterval.minSec) settings.compareInterval.minSec = n;
}

/* ═══ 上下分隔条拖动 ═══ */

const splitEl = ref<HTMLElement | null>(null);
const ratio = ref(0.58);
let drag: { y: number; ratio: number; h: number } | null = null;

function onDividerDown(e: PointerEvent): void {
  const h = splitEl.value?.clientHeight ?? 0;
  if (!h) return;
  drag = { y: e.clientY, ratio: ratio.value, h };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onDividerMove(e: PointerEvent): void {
  if (!drag) return;
  ratio.value = Math.min(0.88, Math.max(0.12, drag.ratio + (e.clientY - drag.y) / drag.h));
}

function onDividerUp(): void {
  drag = null;
}

/* 每行框比例:已出图的用该行实际尺寸(横竖混排也能各自精确);
   等待行用当前生图尺寸预测;都失败时回落竖图默认值。 */
function frameRatioOf(row: CompareRunRow): string {
  if (row.width > 0 && row.height > 0) return `${row.width} / ${row.height}`;
  try {
    const { width, height } = parseResolution(settings.nai.portraitSize || '832×1216');
    return `${width} / ${height}`;
  } catch {
    return '832 / 1216';
  }
}

/* ═══ 结果拖拽排序(原生 HTML5 拖放,直接改 compareRun.rows) ═══ */

const dragFrom = ref<number | null>(null);
const dragOver = ref<number | null>(null);

function onResDragStart(i: number): void {
  dragFrom.value = i;
}

function onResDragOver(e: DragEvent, i: number): void {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  if (dragFrom.value === null || dragFrom.value === i) return;
  dragOver.value = i;
}

function onResDrop(i: number): void {
  const from = dragFrom.value;
  if (from !== null && from !== i) {
    const arr = compareRun.rows;
    const [moved] = arr.splice(from, 1);
    arr.splice(i, 0, moved);
  }
  dragFrom.value = null;
  dragOver.value = null;
}

function onResDragEnd(): void {
  dragFrom.value = null;
  dragOver.value = null;
}
</script>

<template>
  <div class="tlb-lib" :class="{ 'tlb-lib--mobile': isMobile }">
    <!-- 工具栏(单行,所有模式共用):搜索框常驻最左,右侧按模式切换控件 -->
    <div class="tlb-lib__toolbar">
      <div class="tlb-row tlb-row--wrap tlb-lib__toolbar-row">
        <!-- 搜索画师名:仅过滤显示,不影响已选集合 -->
        <div class="tlb-lib__search">
          <span class="tlb-lib__search-icon"><Icon name="search" :size="14" /></span>
          <input
            v-model="searchQuery"
            class="tlb-lib__search-input"
            type="search"
            placeholder="搜索画师串名字…"
          />
          <button
            v-if="searchQuery"
            class="tlb-lib__search-clear"
            title="清空搜索"
            @click="searchQuery = ''"
          >
            <Icon name="close" :size="12" />
          </button>
        </div>

        <!-- 浏览态:两个入口 + 说明 -->
        <template v-if="mode === 'view'">
          <button class="tlb-btn tlb-btn--sm" @click="enterMode('batch')">
            <Icon name="settings" /> 批量管理
          </button>
          <button class="tlb-btn tlb-btn--sm tlb-btn--accent" @click="enterMode('compare')">
            <Icon name="layers" /> 生成对比
          </button>
          <span class="tlb-lib__tip" tabindex="0">
            <Icon name="info" />
            <span class="tlb-lib__tip-body">
              <span class="tlb-lib__tip-lead">勾选多位画师，用「生成」页当前正向提示词各出一张，横向并列便于挑选画风。</span>
              <span><b>① 公平口径：</b>同一轮共用种子，画师串是唯一变量；各预设的质量词/负面词留空时回落全局覆写。</span>
              <span><b>② 防风控：</b>每张之间随机等待（默认 10–30 秒），可随时停止，切页不丢进度；结果可拖拽调整顺序。</span>
            </span>
          </span>
          <span class="tlb-grow" />
          <span class="tlb-hint">{{ settings.artistPresets.length }} 位画师</span>
        </template>

        <!-- 批量管理:全选 / 导出选中 / 删除(两步确认) / 完成 -->
        <template v-else-if="mode === 'batch'">
          <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" @click="toggleAll">
            {{ isAllSelected ? '取消全选' : '全选' }}
          </button>
          <button class="tlb-btn tlb-btn--sm" :disabled="!selected.length" @click="askExport([...selected])">
            <Icon name="export" /> 导出选中{{ selected.length ? ` (${selected.length})` : '' }}
          </button>
          <span class="tlb-lib__confirm-wrap">
            <button
              class="tlb-btn tlb-btn--sm tlb-btn--danger"
              :disabled="!selected.length"
              @click="askBatchDelete"
            >
              <Icon name="trash" /> 删除{{ selected.length ? ` (${selected.length})` : '' }}
            </button>
            <span v-if="confirmDeleteOpen" class="tlb-lib__confirm">
              <span class="tlb-lib__confirm-text">
                确认删除选中的 <b>{{ selected.length }}</b> 位画师?预览图一并删除,不可恢复
              </span>
              <span class="tlb-lib__confirm-btns">
                <button class="tlb-btn tlb-btn--sm" @click="confirmDeleteOpen = false">取消</button>
                <button class="tlb-btn tlb-btn--sm tlb-btn--danger" @click="batchDelete">确认删除</button>
              </span>
            </span>
          </span>
          <span class="tlb-grow" />
          <span class="tlb-hint">点击卡片任意位置选取({{ selected.length }}/{{ settings.artistPresets.length }})</span>
          <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" @click="exitMode">完成</button>
        </template>

        <!-- 生成对比选取:开始生成 + 间隔设置 + 完成 -->
        <template v-else>
          <button
            class="tlb-btn tlb-btn--sm tlb-btn--accent"
            :disabled="!selected.length || compareRun.running"
            @click="startRun"
          >
            <Icon name="layers" /> 开始生成{{ selected.length ? ` (${selected.length})` : '' }}
          </button>
          <span class="tlb-lib__interval">
            间隔
            <input
              class="tlb-lib__interval-input"
              type="number"
              min="0"
              max="60"
              :value="settings.compareInterval.minSec"
              @input="setIntervalMin(numFromEvent($event))"
            />
            –
            <input
              class="tlb-lib__interval-input"
              type="number"
              min="0"
              max="60"
              :value="settings.compareInterval.maxSec"
              @input="setIntervalMax(numFromEvent($event))"
            />
            秒
          </span>
          <span class="tlb-grow" />
          <span class="tlb-hint">无数量上限 · 共用种子 · 已选 {{ selected.length }} 位</span>
          <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" @click="exitMode">完成</button>
        </template>
      </div>
    </div>

    <!-- 上下分区 -->
    <div ref="splitEl" class="tlb-lib__split">
      <!-- 上:画师卡片网格 -->
      <div class="tlb-lib__picks tlb-scroll" :style="{ flexGrow: ratio }">
        <figure
          v-for="a in filteredPresets"
          :key="a.id"
          class="tlb-lib__card"
          :class="{ 'tlb-lib__card--on': isSelected(a.id) }"
          @click="onCardClick(a)"
        >
          <span class="tlb-lib__cardname" :title="a.name">
            <span class="tlb-lib__cardname-text">{{ a.name }}</span>
            <!-- 默认模式:导出 / 删除 常驻标题列右侧;删除走二次确认 -->
            <span v-if="!picking && cardConfirmId !== a.id" class="tlb-lib__actions">
              <button class="tlb-lib__cardbtn" title="导出" @click.stop="askExport([a.id])">
                <Icon name="export" :size="12" />
              </button>
              <button class="tlb-lib__cardbtn tlb-lib__cardbtn--danger" title="删除" @click.stop="askCardDelete(a.id)">
                <Icon name="trash" :size="12" />
              </button>
            </span>
            <span v-else-if="!picking" class="tlb-lib__actions tlb-lib__actions--confirm">
              <button class="tlb-lib__cardconfirm tlb-lib__cardconfirm--ok" title="确认删除" @click.stop="confirmCardDelete">删</button>
              <button class="tlb-lib__cardconfirm" title="取消" @click.stop="cancelCardDelete">否</button>
            </span>
          </span>
          <span class="tlb-lib__media">
            <img v-if="previewSrc(a.id)" class="tlb-lib__img" :src="previewSrc(a.id)" :alt="a.name" />
            <span v-else class="tlb-lib__noimg">无预览图</span>
          </span>
        </figure>
        <p v-if="!settings.artistPresets.length" class="tlb-hint tlb-lib__picks-empty">
          还没有画师串:到「设置」从柏宝绘 / 智绘姬 / 小白X同步,或在「生成」页用画师串预设 ＋ 新建。
        </p>
        <p v-else-if="!filteredPresets.length" class="tlb-hint tlb-lib__picks-empty">
          没有名字包含「{{ searchQuery.trim() }}」的画师
        </p>
      </div>

      <!-- 分隔条:整条水平可拖动 -->
      <div
        class="tlb-lib__divider"
        role="separator"
        aria-orientation="horizontal"
        title="拖动调整上下比例(双击复位)"
        @pointerdown="onDividerDown"
        @pointermove="onDividerMove"
        @pointerup="onDividerUp"
        @pointercancel="onDividerUp"
        @dblclick="ratio = 0.58"
      >
        <span class="tlb-lib__divider-grip"><Icon name="grip" :size="14" /></span>
      </div>

      <!-- 下:对比结果 -->
      <section class="tlb-lib__results" :style="{ flexGrow: 1 - ratio }">
        <div class="tlb-lib__reshead">
          <strong>对比结果</strong>
          <span v-if="compareRun.rows.length" class="tlb-hint">
            {{ doneCount }}/{{ compareRun.rows.length }}
          </span>
          <span class="tlb-hint tlb-lib__reshint">左右滑动浏览 · 拖拽图片调整顺序</span>
          <span class="tlb-grow" />
          <button
            v-if="compareRun.running"
            class="tlb-btn tlb-btn--sm tlb-btn--danger"
            @click="stopCompareRun()"
          >
            <Icon name="ban" /> 停止
          </button>
          <button
            v-else
            class="tlb-btn tlb-btn--ghost tlb-btn--sm"
            :disabled="!compareRun.rows.length"
            @click="clearCompareResults()"
          >
            清空
          </button>
        </div>

        <div v-if="compareRun.rows.length" class="tlb-lib__resgrid tlb-scroll">
          <figure
            v-for="(row, i) in compareRun.rows"
            :key="row.presetId"
            class="tlb-lib__rescell"
            :class="{
              'tlb-lib__rescell--dragging': dragFrom === i,
              'tlb-lib__rescell--dragover': dragOver === i && dragFrom !== i,
            }"
            :style="{ aspectRatio: frameRatioOf(row) }"
            draggable="true"
            @dragstart="onResDragStart(i)"
            @dragover="onResDragOver($event, i)"
            @drop="onResDrop(i)"
            @dragend="onResDragEnd"
          >
            <div class="tlb-lib__resmedia">
              <!-- 图片区:纯填满卡片的图片框,比例由卡片自身决定 -->
              <span class="tlb-lib__resframe">
                <img
                  v-if="row.status === 'done' && compareRun.urls[row.imageId]"
                  class="tlb-lib__resframe-img"
                  :src="compareRun.urls[row.imageId]"
                  :alt="row.name"
                  draggable="false"
                />
                <!-- 未出图时才显示状态图标(v-else 与 img 同链,避免叠在成品图上) -->
                <template v-else>
                  <Icon v-if="row.status === 'generating'" name="loader" spin />
                  <Icon v-else-if="row.status === 'error'" name="warning" />
                  <Icon v-else-if="row.status === 'stopped'" name="ban" />
                  <Icon v-else name="layers" class="tlb-lib__residle" />
                </template>
              </span>
            </div>
            <figcaption>
              <strong :title="row.name">{{ row.name }}</strong>
              <span v-if="row.status === 'waiting'" class="tlb-hint">等待中</span>
              <span v-else-if="row.status === 'stopped'" class="tlb-hint">已停止</span>
              <span v-if="row.status === 'error'" class="tlb-lib__err">{{ row.error }}</span>
            </figcaption>
          </figure>
        </div>
        <p v-else class="tlb-hint tlb-lib__results-empty">生成的对比图会在这里横向并排显示</p>
      </section>
    </div>

    <!-- 导出附带 vibe 选择弹窗 -->
    <div v-if="picker.open" ref="pickerBackdropEl" class="tlb-lib-vp-backdrop" @click.self="picker.open = false">
      <div class="tlb-lib-vp-stage" :style="pickerAnchorStyle">
      <div class="tlb-lib-vp" role="dialog" aria-modal="true" aria-label="选择导出附带的 Vibe">
        <div class="tlb-lib-vp__head">
          <strong><Icon name="wand-sparkles" /> 选择附带的 Vibe</strong>
          <span class="tlb-grow" />
          <button class="tlb-lib-vp__close" title="关闭" @click="picker.open = false">
            <Icon name="close" />
          </button>
        </div>
        <p class="tlb-hint tlb-lib-vp__hint">
          将导出 {{ picker.presetIds.length }} 位画师的资料;vibe 为可选项,不支持的插件导入时自动跳过。
        </p>
        <div class="tlb-lib-vp__list tlb-scroll">
          <label v-for="v in vibeList.items" :key="v.id" class="tlb-lib-vp__item">
            <span class="tlb-lib-vp__thumb">
              <img v-if="v.thumbnail" :src="v.thumbnail" :alt="v.name" />
              <Icon v-else name="image" />
            </span>
            <span class="tlb-lib-vp__name" :title="v.name">{{ v.name }}</span>
            <input v-model="picker.vibeIds" class="tlb-lib-vp__check" type="checkbox" :value="v.id" />
          </label>
          <p v-if="!vibeList.items.length" class="tlb-hint tlb-lib-vp__empty">
            vibe 库为空,可直接导出画师资料
          </p>
        </div>
        <div class="tlb-lib-vp__foot">
          <button
            v-if="vibeList.items.length"
            class="tlb-btn tlb-btn--ghost tlb-btn--sm"
            @click="pickerToggleAll"
          >
            {{ pickerAll ? '全不选' : '全选' }}
          </button>
          <span class="tlb-grow" />
          <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" @click="picker.open = false">取消</button>
          <button class="tlb-btn tlb-btn--sm tlb-btn--accent" @click="confirmExport">
            导出{{ picker.vibeIds.length ? `(含 ${picker.vibeIds.length} 个 vibe)` : '' }}
          </button>
        </div>
      </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 整页占满面板体:工具栏 + 上下分区 */
.tlb-lib {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 0;
  box-sizing: border-box;
}

.tlb-lib__toolbar {
  flex: none;
}

.tlb-lib__toolbar-row {
  gap: 6px;
}

/* ---- 搜索框(所有模式通用) ---- */
.tlb-lib__search {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 220px;
  max-width: 100%;
  height: 26px;
  padding: 0 9px;
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius-pill);
  background: var(--tlb-surface);
  box-sizing: border-box;
}

.tlb-lib__search:focus-within {
  border-color: var(--tlb-accent);
}

.tlb-lib__search-icon {
  flex: none;
  display: flex;
  color: var(--tlb-ink-muted);
}

.tlb-lib__search-input {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--tlb-ink);
  font-size: 12.5px;
}

.tlb-lib__search-input::placeholder {
  color: var(--tlb-ink-muted);
}

/* 用自定义清除钮,隐藏浏览器原生 × */
.tlb-lib__search-input::-webkit-search-cancel-button {
  -webkit-appearance: none;
  appearance: none;
}

.tlb-lib__search-clear {
  flex: none;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: var(--tlb-radius-pill);
  background: var(--tlb-surface-2);
  color: var(--tlb-ink-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tlb-lib__search-clear:hover {
  color: var(--tlb-ink);
}

/* ---- 上下分区容器 ---- */
.tlb-lib__split {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* 上/下区域:flex-grow 行内给定,basis 为 0,高度严格按比例 */
.tlb-lib__picks,
.tlb-lib__results {
  flex-basis: 0;
  min-height: 0;
}

/* ---- 上:画师卡片网格 ---- */
.tlb-lib__picks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  grid-auto-rows: min-content;
  gap: 10px;
  align-content: start;
  overflow-y: auto;
  padding-right: 4px;
}

.tlb-lib__picks-empty {
  grid-column: 1 / -1;
  margin: 0;
  padding: 24px 0;
  text-align: center;
}

.tlb-lib__card {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius-sm);
  background: var(--tlb-surface);
  overflow: hidden;
  cursor: pointer;
}

.tlb-lib__card--on {
  border-color: var(--tlb-accent);
  box-shadow: 0 0 0 1px var(--tlb-accent);
}

.tlb-lib__cardname {
  flex: none;
  padding: 5px 8px;
  font-size: 12.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tlb-lib__media {
  position: relative;
  display: block;
  aspect-ratio: 1;
  background: var(--tlb-surface-2);
  overflow: hidden;
}

.tlb-lib__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.tlb-lib__noimg {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--tlb-ink-muted);
}

/* 默认模式:hover 右下操作按钮组 */
.tlb-lib__actions {
  position: absolute;
  right: 6px;
  bottom: 6px;
  z-index: 2;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity var(--tlb-dur) var(--tlb-ease);
}

.tlb-lib__card:hover .tlb-lib__actions {
  opacity: 1;
}

.tlb-lib__cardbtn {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--tlb-radius-pill);
  background: var(--tlb-overlay);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tlb-lib__cardbtn--danger {
  background: var(--tlb-danger);
}

/* 卡片標題列二次確認小鈕(基底樣式;retro 在主題檔覆寫) */
.tlb-lib__cardconfirm {
  height: 18px;
  padding: 0 5px;
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius-sm);
  background: var(--tlb-surface);
  color: var(--tlb-ink-soft);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.tlb-lib__cardconfirm--ok {
  border-color: var(--tlb-danger);
  color: var(--tlb-danger);
}

.tlb-lib__cardconfirm--ok:hover {
  background: var(--tlb-danger);
  color: #fff;
}

/* ---- 分隔条:整条水平条,横贯面板(静态,拖拽不高亮) ---- */
.tlb-lib__divider {
  flex: none;
  height: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 2px 0;
  border-top: 1px solid var(--tlb-line);
  border-bottom: 1px solid var(--tlb-line);
  background: var(--tlb-surface-2);
  color: var(--tlb-ink-muted);
  cursor: row-resize;
  touch-action: none;
  user-select: none;
}

.tlb-lib__divider-grip {
  display: flex;
}

/* ---- i 说明气泡(对齐 vibe 的 info 做法) ---- */
.tlb-lib__tip {
  position: relative;
  display: inline-flex;
  align-items: center;
  color: var(--tlb-ink-muted);
  cursor: help;
  outline: none;
}

.tlb-lib__tip:hover,
.tlb-lib__tip:focus {
  color: var(--tlb-ink);
}

.tlb-lib__tip-body {
  display: none;
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 60;
  width: 300px;
  max-width: calc(100vw - 48px);
  padding: 10px 12px;
  border: 1px solid var(--tlb-line);
  border-radius: 8px;
  background: var(--tlb-surface);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  color: var(--tlb-ink-muted);
  font-size: 12px;
  line-height: 1.7;
  text-align: left;
  white-space: normal;
  flex-direction: column;
  gap: 6px;
}

.tlb-lib__tip-body b {
  color: var(--tlb-ink);
  font-weight: 600;
}

.tlb-lib__tip-lead {
  color: var(--tlb-ink);
}

.tlb-lib__tip:hover .tlb-lib__tip-body,
.tlb-lib__tip:focus .tlb-lib__tip-body,
.tlb-lib__tip:focus-within .tlb-lib__tip-body {
  display: flex;
}

/* ---- 下:对比结果 ---- */
.tlb-lib__results {
  display: flex;
  flex-direction: column;
}

.tlb-lib__reshead {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 9px;
  padding-bottom: 8px;
}

.tlb-lib__reshint {
  margin-left: 2px;
}

/* 横向并排:高度填满结果区,左右滑动浏览 */
.tlb-lib__resgrid {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: stretch;
  gap: 12px;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 4px;
}

.tlb-lib__rescell {
  flex: none;
  height: 100%;
  margin: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius-sm);
  background: var(--tlb-surface);
  overflow: hidden;
  cursor: grab;
}

.tlb-lib__rescell figcaption {
  flex: none;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
}

.tlb-lib__resmedia {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: stretch;
  background: var(--tlb-surface-2);
  overflow: hidden;
}

/* 图片框:纯填满卡片媒体区(卡片自身已按 aspect-ratio 定宽) */
.tlb-lib__resframe {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--tlb-ink-muted);
}

.tlb-lib__resframe .tlb-icon {
  font-size: 24px;
}

.tlb-lib__resframe .tlb-icon--spin {
  color: var(--tlb-accent);
}

.tlb-lib__residle {
  opacity: 0.35;
}

/* 成品图填满固定比例框(标准 NAI 竖图比例下零裁切) */
.tlb-lib__resframe-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.tlb-lib__rescell figcaption strong {
  font-size: 12.5px;
  /* 卡片宽度已由 height×aspect-ratio 决定(不依赖内容),名字超宽即截断 */
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 拖拽排序视觉态 */
.tlb-lib__rescell--dragging {
  opacity: 0.45;
  cursor: grabbing;
}

.tlb-lib__rescell--dragover {
  border-color: var(--tlb-accent);
  box-shadow: -3px 0 0 0 var(--tlb-accent);
}

.tlb-lib__err {
  font-size: 11.5px;
  color: var(--tlb-danger);
  word-break: break-word;
}

.tlb-lib__results-empty {
  flex: 1;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ---- 删除确认弹层 ---- */
.tlb-lib__confirm-wrap {
  position: relative;
}

.tlb-lib__confirm {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 280px;
  max-width: calc(100vw - 40px);
  padding: 10px 12px;
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius-sm);
  background: var(--tlb-surface-opaque, var(--tlb-surface));
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.tlb-lib__confirm-text {
  font-size: 12px;
  color: var(--tlb-ink-soft);
}

.tlb-lib__confirm-text b {
  color: var(--tlb-danger);
}

.tlb-lib__confirm-btns {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

/* ---- 间隔秒数输入 ---- */
.tlb-lib__interval {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--tlb-ink-soft);
}

.tlb-lib__interval-input {
  width: 52px;
  height: 26px;
  padding: 0 4px;
  text-align: center;
  box-sizing: border-box;
}

/* ---- vibe 选择弹窗 ---- */
.tlb-lib-vp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10025;
  background: rgba(0, 0, 0, 0.4);
  /* 挂在 .tlb-root(pointer-events:none)下,必须恢复 */
  pointer-events: auto;
}

/* 對齊浮動面板實測矩形的置中容器(視窗縮放不偏移) */
.tlb-lib-vp-stage {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
}

.tlb-lib-vp {
  display: flex;
  flex-direction: column;
  width: 460px;
  max-width: 100%;
  max-height: 100%;
  background: var(--tlb-surface-opaque, var(--tlb-surface));
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius);
  overflow: hidden;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
}

.tlb-lib-vp__head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--tlb-line);
}

.tlb-lib-vp__close {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--tlb-ink-soft);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tlb-lib-vp__hint {
  flex: none;
  margin: 0;
  padding: 10px 14px 0;
}

.tlb-lib-vp__list {
  flex: 1;
  min-height: 80px;
  padding: 8px 14px;
  overflow-y: auto;
}

.tlb-lib-vp__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 2px;
  cursor: pointer;
}

.tlb-lib-vp__thumb {
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: var(--tlb-radius-sm);
  background: var(--tlb-surface-2);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--tlb-ink-muted);
}

.tlb-lib-vp__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.tlb-lib-vp__name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tlb-lib-vp__check {
  flex: none;
  width: 16px;
  height: 16px;
  accent-color: var(--tlb-accent);
}

.tlb-lib-vp__empty {
  margin: 0;
  padding: 16px 0;
  text-align: center;
}

.tlb-lib__results-foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border-top: 1px solid var(--tlb-line);
}

/* ---- 手機:搜索獨佔一行;畫師卡片每行 3 個 ---- */
.tlb-lib--mobile {
  gap: 8px;
  padding: 10px 0;
}

.tlb-lib--mobile .tlb-lib__search {
  flex: 1 1 100%;
  width: auto;
}

/* 默認態說明 tip 在手機上收起,批量管理/生成對比/畫師數落第二行 */
.tlb-lib--mobile .tlb-lib__tip {
  display: none;
}

.tlb-lib--mobile .tlb-lib__picks {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
</style>
