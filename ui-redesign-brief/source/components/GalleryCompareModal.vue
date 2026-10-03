<script setup lang="ts">
/**
 * 画廊「多图差异对比」弹窗(挂载在 App 根层,与 PreviewModal 同级)。
 *
 * 数据来源:ui.galleryCompare.ids → history.items 解析元数据(打开前已校验 2–4 条)。
 * 尺寸:以浮动面板自身的实测矩形为基准(面板已保证完整在视口内),
 *   弹窗固定在面板内侧;ResizeObserver 监听面板尺寸/位置变化即时重算,绝不溢出。
 * 排布:2 张 → 一行两列;3–4 张 → 2 列自动换行。
 * 差异:逗号切标签,各列计数取公共数,多出标签用该列识别色高亮;
 *   透明 textarea + 高亮层重叠,滚动同步;临时编辑不写回记录。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import { history } from '@/state/historyList';
import { imageUrl, ui } from '@/state/ui';
import Icon from '@/components/Icon.vue';
import type { TlbHistoryMeta } from '@/types';

type CompareMode = 'prompt' | 'artist';

const compareMode = ref<CompareMode>('prompt');
const compareMetas = ref<TlbHistoryMeta[]>([]);
const compareUrls = ref<string[]>([]);
const texts = ref<string[]>([]);

/* ---- 尺寸:实测浮动面板矩形,弹窗贴在面板内侧 ---- */

const MARGIN = 10;
const backdropEl = ref<HTMLElement | null>(null);
const box = ref({ x: MARGIN, y: MARGIN, w: 800, h: 600 });

let ro: ResizeObserver | null = null;

function measure(): void {
  const root = backdropEl.value?.getRootNode();
  const panel =
    root instanceof ShadowRoot ? (root.querySelector('.tlb-panel') as HTMLElement | null) : null;
  const r = panel?.getBoundingClientRect();
  if (r && r.width > 80 && r.height > 120) {
    box.value = {
      x: r.left + MARGIN,
      y: r.top + MARGIN,
      w: r.width - MARGIN * 2,
      h: r.height - MARGIN * 2,
    };
  } else {
    // 面板找不到时的兜底:整窗
    box.value = {
      x: MARGIN,
      y: MARGIN,
      w: window.innerWidth - MARGIN * 2,
      h: window.innerHeight - MARGIN * 2,
    };
  }
}

let rafQueued = false;
function queueMeasure(): void {
  if (rafQueued) return;
  rafQueued = true;
  requestAnimationFrame(() => {
    rafQueued = false;
    measure();
  });
}

function startObserving(): void {
  stopObserving();
  const root = backdropEl.value?.getRootNode();
  const panel =
    root instanceof ShadowRoot ? (root.querySelector('.tlb-panel') as HTMLElement | null) : null;
  ro = new ResizeObserver(queueMeasure);
  if (panel) ro.observe(panel);
  window.addEventListener('resize', queueMeasure);
  measure();
}

function stopObserving(): void {
  ro?.disconnect();
  ro = null;
  window.removeEventListener('resize', queueMeasure);
}

const dialogStyle = computed(() => ({
  left: `${box.value.x}px`,
  top: `${box.value.y}px`,
  width: `${box.value.w}px`,
  maxHeight: `${box.value.h}px`,
}));

/** 列数:2 张 → 2;3–4 张 → 2(自动换行)。 */
const cols = computed(() => (compareMetas.value.length >= 2 ? 2 : 1));

function textOf(meta: TlbHistoryMeta, mode: CompareMode): string {
  return mode === 'prompt' ? meta.rawPrompt || meta.prompt || '' : meta.artistPrompt || '';
}

function reset(): void {
  const ids = ui.galleryCompare.ids;
  const metas = ids.map(id => history.items.find(i => i.id === id)).filter((m): m is TlbHistoryMeta => !!m);
  compareMetas.value = metas;
  compareMode.value = 'prompt';
  texts.value = metas.map(m => textOf(m, 'prompt'));
  compareUrls.value = metas.map(() => '');
  metas.forEach(async (m, i) => {
    compareUrls.value[i] = (await imageUrl(m.id)) ?? '';
  });
}

watch(
  () => ui.galleryCompare.open,
  open => {
    if (open) {
      reset();
      void nextTick(startObserving);
    } else {
      stopObserving();
    }
  },
);

function closeCompare(): void {
  ui.galleryCompare.open = false;
  taRefs.length = 0;
  hlRefs.length = 0;
}

function switchMode(mode: CompareMode): void {
  compareMode.value = mode;
  texts.value = compareMetas.value.map(m => textOf(m, mode));
}

// Esc 关闭(捕获阶段,避免冒泡关掉整个面板)
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && ui.galleryCompare.open) {
    e.stopPropagation();
    closeCompare();
  }
}

onMounted(() => window.addEventListener('keydown', onKey, true));
onUnmounted(() => {
  window.removeEventListener('keydown', onKey, true);
  stopObserving();
});

/* ═══ 标签级差异 ═══ */

function splitParts(text: string): string[] {
  return text.split(/(,)/);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function segKey(part: string): string {
  return part.trim().toLowerCase();
}

/** 第 col 列高亮 HTML。 */
function renderHl(col: number): string {
  const perCols = texts.value.map(t => {
    const parts = splitParts(t);
    const counts = new Map<string, number>();
    for (let i = 0; i < parts.length; i += 2) {
      const k = segKey(parts[i]);
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return { parts, counts };
  });

  // 公共数 = 各列计数最小值
  const common = new Map<string, number>();
  for (const { counts } of perCols) {
    for (const [k, n] of counts) {
      const cur = common.get(k);
      common.set(k, cur === undefined ? n : Math.min(cur, n));
    }
  }
  for (const { counts } of perCols) {
    for (const k of common.keys()) {
      if (!counts.has(k)) common.set(k, 0);
    }
  }

  const seen = new Map<string, number>();
  const { parts } = perCols[col];
  let html = '';
  for (let i = 0; i < parts.length; i += 2) {
    const raw = parts[i];
    const k = segKey(raw);
    const occ = seen.get(k) ?? 0;
    seen.set(k, occ + 1);
    const different = !!k && occ >= (common.get(k) ?? 0);
    const lm = /^\s*/.exec(raw)?.[0] ?? '';
    const rm = /\s*$/.exec(raw)?.[0] ?? '';
    const core = raw.slice(lm.length, raw.length - rm.length);
    html += escapeHtml(lm);
    html += different
      ? `<mark class="tlb-gcmp__mark tlb-gcmp__mark--${col}">${escapeHtml(core)}</mark>`
      : escapeHtml(core);
    html += escapeHtml(rm);
    if (i + 1 < parts.length) html += escapeHtml(parts[i + 1]);
  }
  return html + ' ';
}

const hlHtml = computed<string[]>(() => compareMetas.value.map((_, i) => renderHl(i)));

/* ═══ textarea / 高亮层同步 ═══ */

const taRefs: HTMLTextAreaElement[] = [];
const hlRefs: HTMLPreElement[] = [];

function setTaRef(el: unknown, i: number): void {
  if (el instanceof HTMLTextAreaElement) taRefs[i] = el;
}
function setHlRef(el: unknown, i: number): void {
  if (el instanceof HTMLPreElement) hlRefs[i] = el;
}

function syncScroll(i: number, ev: Event): void {
  const ta = ev.target as HTMLTextAreaElement;
  const hl = hlRefs[i];
  if (hl) {
    hl.scrollTop = ta.scrollTop;
    hl.scrollLeft = ta.scrollLeft;
  }
}

function timeOf(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
</script>

<template>
  <div v-if="ui.galleryCompare.open" ref="backdropEl" class="tlb-gcmp-backdrop" @click.self="closeCompare">
    <div class="tlb-gcmp" role="dialog" aria-modal="true" aria-label="多图差异对比" :style="dialogStyle">
      <div class="tlb-gcmp__head">
        <strong><Icon name="layers" /> 多图差异对比</strong>
        <span class="tlb-grow" />
        <button class="tlb-gcmp__close" title="关闭" @click="closeCompare"><Icon name="close" /></button>
      </div>

      <div class="tlb-gcmp__body tlb-scroll">
        <!-- 图片并排:2 张一行;3–4 张 2 列自动换行 -->
        <div class="tlb-gcmp__imgs" :style="{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }">
          <div v-for="(meta, i) in compareMetas" :key="meta.id" class="tlb-gcmp__imgcol">
            <div class="tlb-gcmp__media">
              <img v-if="compareUrls[i]" :src="compareUrls[i]" :alt="`#${i + 1}`" />
              <div v-else class="tlb-gcmp__medialoading"><Icon name="loader" spin /></div>
            </div>
            <div class="tlb-gcmp__imginfo">
              <strong>#{{ i + 1 }} · {{ meta.width }}×{{ meta.height }}</strong>
              <span class="tlb-hint">s{{ meta.seed }} · {{ timeOf(meta.createdAt) }}</span>
            </div>
          </div>
        </div>

        <!-- 对比项目切换 -->
        <div class="tlb-gcmp__modebar">
          <span class="tlb-hint">对比项目:</span>
          <div class="tlb-gcmp__seg">
            <button type="button" :class="{ 'is-on': compareMode === 'prompt' }" @click="switchMode('prompt')">提示詞</button>
            <button type="button" :class="{ 'is-on': compareMode === 'artist' }" @click="switchMode('artist')">畫師串</button>
          </div>
          <span class="tlb-grow" />
          <span class="tlb-hint">底色 = 该图独有标签;可临时编辑,差异实时更新</span>
        </div>

        <!-- 每列差异(2 列,与上方图片列对齐) -->
        <div class="tlb-gcmp__diffs" :style="{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }">
          <div v-for="(meta, i) in compareMetas" :key="`d-${meta.id}`" class="tlb-gcmp__diffcol">
            <div class="tlb-gcmp__diffwrap">
              <pre class="tlb-gcmp__hl" :ref="el => setHlRef(el, i)" v-html="hlHtml[i]" aria-hidden="true" />
              <textarea
                :ref="el => setTaRef(el, i)"
                v-model="texts[i]"
                class="tlb-gcmp__text"
                :placeholder="compareMode === 'artist' ? '(未使用畫師串)' : ''"
                spellcheck="false"
                @scroll="syncScroll(i, $event)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tlb-gcmp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10020;
  background: rgba(0, 0, 0, 0.4);
  /* 挂在 .tlb-root(pointer-events:none)下,必须恢复,否则弹窗内按钮全点不动 */
  pointer-events: auto;
}

.tlb-gcmp {
  /* 位置/尺寸全部来自实测面板矩形(dialogStyle),保证不超出可见区 */
  position: absolute;
  display: flex;
  flex-direction: column;
  background: var(--tlb-surface-opaque, var(--tlb-surface));
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius);
  overflow: hidden;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
}

.tlb-gcmp__head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--tlb-line);
}

.tlb-gcmp__close {
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

.tlb-gcmp__close:hover {
  color: var(--tlb-ink);
}

.tlb-gcmp__body {
  flex: 1;
  min-height: 0;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}

/* ---- 图片区 ---- */
.tlb-gcmp__imgs {
  flex: none;
  display: grid;
  gap: 12px;
}

.tlb-gcmp__imgcol {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.tlb-gcmp__media {
  height: 170px;
  border-radius: var(--tlb-radius-sm);
  background: var(--tlb-surface-2-opaque, var(--tlb-surface-2));
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.tlb-gcmp__media img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.tlb-gcmp__medialoading {
  color: var(--tlb-ink-muted);
}

.tlb-gcmp__imginfo {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  font-size: 12px;
}

/* ---- 模式切换 ---- */
.tlb-gcmp__modebar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.tlb-gcmp__seg {
  display: inline-flex;
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius-sm);
  overflow: hidden;
}

.tlb-gcmp__seg button {
  border: none;
  background: transparent;
  color: var(--tlb-ink-soft);
  font-size: 12.5px;
  padding: 5px 14px;
  cursor: pointer;
}

.tlb-gcmp__seg button + button {
  border-left: 1px solid var(--tlb-line);
}

.tlb-gcmp__seg button.is-on {
  background: var(--tlb-accent);
  color: var(--tlb-accent-ink);
  font-weight: 600;
}

/* ---- 差异区(2 列自动换行,每格定高) ---- */
.tlb-gcmp__diffs {
  flex: none;
  display: grid;
  gap: 12px;
}

.tlb-gcmp__diffcol {
  min-width: 0;
  display: flex;
}

.tlb-gcmp__diffwrap {
  position: relative;
  flex: 1;
  height: 130px;
}

.tlb-gcmp__hl,
.tlb-gcmp__text {
  position: absolute;
  inset: 0;
  margin: 0;
  box-sizing: border-box;
  padding: 8px;
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius-sm);
  font-family: inherit;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-break: break-word;
}

.tlb-gcmp__hl {
  color: var(--tlb-ink-soft);
  background: var(--tlb-surface-2-opaque, var(--tlb-surface-2));
  overflow: hidden;
  pointer-events: none;
}

.tlb-gcmp__text {
  background: transparent;
  color: transparent;
  caret-color: var(--tlb-accent);
  resize: none;
  outline: none;
}

.tlb-gcmp__text::selection {
  background: rgba(59, 130, 246, 0.35);
  color: #fff;
}

.tlb-gcmp__mark {
  border-radius: 3px;
  padding: 0 1px;
  color: #fff;
}

.tlb-gcmp__mark--0 {
  background: rgba(217, 119, 6, 0.9);
}

.tlb-gcmp__mark--1 {
  background: rgba(139, 92, 246, 0.9);
}

.tlb-gcmp__mark--2 {
  background: rgba(14, 165, 233, 0.9);
}

.tlb-gcmp__mark--3 {
  background: rgba(22, 163, 74, 0.9);
}
</style>
