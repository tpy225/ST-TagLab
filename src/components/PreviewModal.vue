<script setup lang="ts">
/**
 * 图片预览弹窗(画廊点图 / 生成页大图点击共用)。
 * 底部四钮:水印工坊(M5,先置灰)、回傳生成(参数回填并跳生成页)、下载、删除。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import { currentItem, history, removeHistory, stepSelection } from '@/state/historyList';
import { imageUrl, openPanel, ui } from '@/state/ui';
import { notify } from '@/st/toast';
import Icon from '@/components/Icon.vue';

const item = computed(() => currentItem());
const url = ref<string | null>(null);

/* ---- 尺寸:实测浮动面板矩形,弹窗贴在面板内侧,水平居中 ---- */

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
    const w = Math.min(900, r.width - MARGIN * 2);
    box.value = {
      x: r.left + (r.width - w) / 2,
      y: r.top + MARGIN,
      w,
      h: r.height - MARGIN * 2,
    };
  } else {
    box.value = {
      x: MARGIN,
      y: MARGIN,
      w: Math.min(900, window.innerWidth - MARGIN * 2),
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

/** 确定的宽高:有了确定高度,图片区百分比高度才生效,图片自动置中缩放。 */
const dialogStyle = computed(() => ({
  left: `${box.value.x}px`,
  top: `${box.value.y}px`,
  width: `${box.value.w}px`,
  height: `${box.value.h}px`,
}));

// 捕获阶段截下 Esc,避免冒泡到浮窗导致整个面板被关
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation();
    close();
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey, true);
  void nextTick(startObserving);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKey, true);
  stopObserving();
});

watch(
  () => ui.currentId,
  async id => {
    url.value = id ? await imageUrl(id) : null;
  },
  { immediate: true },
);

function close(): void {
  ui.previewOpen = false;
}

function prev(): void {
  stepSelection(-1);
}

function next(): void {
  stepSelection(1);
}

async function download(): Promise<void> {
  const meta = item.value;
  if (!meta) return;
  const u = await imageUrl(meta.id);
  if (!u) {
    notify('error', '图片读取失败');
    return;
  }
  const ext = (meta.mime.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const a = document.createElement('a');
  a.href = u;
  a.download = `taglab_s${meta.seed}.${ext}`;
  a.click();
}

async function remove(): Promise<void> {
  const meta = item.value;
  if (!meta) return;
  if (!window.confirm('删除这张图片?')) return;
  await removeHistory(meta.id); // 内部会把 currentId 移到相邻项;无图则置空
  if (!history.items.length) close();
  notify('success', '已删除');
}

/** 回傳生成:带着这张图的全部参数回到生成页(触发一次回填)。 */
function reuseForGenerate(): void {
  ui.previewOpen = false;
  ui.backfillNonce += 1;
  openPanel('gen');
}

function timeOf(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
</script>

<template>
  <div ref="backdropEl" class="tlb-pv-backdrop" @click.self="close">
    <div class="tlb-pv" role="dialog" aria-modal="true" aria-label="图片预览" :style="dialogStyle">
      <button class="tlb-pv__close" title="关闭" @click="close"><Icon name="close" /></button>

      <template v-if="item">
        <button v-if="history.items.length > 1" class="tlb-pv__nav tlb-pv__nav--l" @click="prev"><Icon name="chevron-left" /></button>
        <div class="tlb-pv__stage">
          <img v-if="url" :src="url" alt="" />
          <div v-else class="tlb-pv__loading"><Icon name="loader" spin /></div>
        </div>
        <button v-if="history.items.length > 1" class="tlb-pv__nav tlb-pv__nav--r" @click="next"><Icon name="chevron-right" /></button>

        <div class="tlb-pv__meta">
          <span>{{ item.width }}×{{ item.height }} · seed {{ item.seed }} · {{ item.model }}</span>
          <span class="tlb-grow" />
          <span>{{ timeOf(item.createdAt) }}</span>
          <span>{{ history.items.findIndex(i => i.id === item!.id) + 1 }} / {{ history.items.length }}</span>
        </div>

        <div class="tlb-pv__actions">
          <button class="tlb-btn tlb-btn--sm" disabled title="即将推出(M5)">
            <Icon name="stamp" /> 水印工坊
          </button>
          <button class="tlb-btn tlb-btn--sm tlb-btn--accent" @click="reuseForGenerate">
            <Icon name="undo" /> 回傳生成
          </button>
          <button class="tlb-btn tlb-btn--sm" @click="download">
            <Icon name="download" /> 下载
          </button>
          <button class="tlb-btn tlb-btn--sm tlb-btn--danger" @click="remove">
            <Icon name="trash" /> 删除
          </button>
        </div>
      </template>

      <div v-else class="tlb-pv__empty">没有可预览的图片。</div>
    </div>
  </div>
</template>

<style scoped>
.tlb-pv-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10020;
  /* 窗外不着色(透明,直接透出后面的界面);窗体本身用主题实色,靠阴影与背景区分 */
  background: transparent;
  pointer-events: auto; /* 挂在 .tlb-root(pointer-events:none)下,必须恢复,否则弹窗内按钮全点不动 */
}

.tlb-pv {
  position: absolute;
  /* 位置/尺寸全部来自实测面板矩形(dialogStyle):确定高度,不溢出 */
  display: flex;
  flex-direction: column;
  /* ST 主题下 --tlb-surface 取自宿主半透明 tint 色,弹窗一律用 App.vue 探针
     拍平后的不透明令牌(带保底),底部信息/按钮区也绝不透出背景。 */
  background: var(--tlb-surface-opaque, var(--tlb-surface));
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius);
  overflow: hidden;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
}

.tlb-pv__close {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  width: 28px;
  height: 28px;
  font-size: 15px;
  border: none;
  background: transparent;
  color: var(--tlb-ink-soft);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color var(--tlb-dur) var(--tlb-ease);
}

.tlb-pv__close:hover {
  color: var(--tlb-ink);
}

.tlb-pv__stage {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 同 .tlb-pv:使用拍平后的不透明 surface-2 */
  background: var(--tlb-surface-2-opaque, var(--tlb-surface-2));
}

.tlb-pv__stage img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  user-select: none;
}

.tlb-pv__loading {
  color: var(--tlb-ink-muted);
  font-size: 28px;
  padding: 80px 0;
}

.tlb-pv__nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
  width: 30px;
  height: 30px;
  font-size: 12px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: var(--tlb-radius-pill);
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--tlb-dur) var(--tlb-ease);
}

.tlb-pv__nav:hover {
  background: rgba(0, 0, 0, 0.72);
}

.tlb-pv__nav--l {
  left: 12px;
}

.tlb-pv__nav--r {
  right: 12px;
}

.tlb-pv__meta {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 8px 14px;
  font-size: 12px;
  color: var(--tlb-ink-muted);
  border-top: 1px solid var(--tlb-line);
}

.tlb-pv__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 14px 14px;
}

.tlb-pv__empty {
  padding: 80px 0;
  text-align: center;
  color: var(--tlb-ink-muted);
}
</style>
