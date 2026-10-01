<script setup lang="ts">
/**
 * 可拖动浮动面板:窗口主体 + 标题栏(拖动手柄) + 内容区 + 底栏 tab。
 * 位置存 settings.panelPos,越界自动拉回。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import { settings } from '@/state/settings';
import { closePanel, ui, type TlbTab } from '@/state/ui';
import Icon from '@/components/Icon.vue';
import type { TlbTheme } from '@/types';

const PANEL_W = 820;
const PANEL_H_RATIO = 0.94;
const version = __TLB_VERSION__;

const pos = ref<{ x: number; y: number }>({ x: 0, y: 0 });
const size = ref({ w: PANEL_W, h: 600 });

const style = computed(() => ({
  left: `${pos.value.x}px`,
  top: `${pos.value.y}px`,
  width: `${size.value.w}px`,
  height: `${size.value.h}px`,
}));

const TABS: { key: TlbTab; label: string; icon: string }[] = [
  { key: 'gen', label: '生成', icon: 'sparkles' },
  { key: 'compare', label: '画师库', icon: 'users' },
  { key: 'gallery', label: '画廊', icon: 'gallery' },
  { key: 'settings', label: '设置', icon: 'settings' },
];

function clampPos(x: number, y: number): { x: number; y: number } {
  const maxX = Math.max(0, window.innerWidth - size.value.w);
  // 必须减去面板自身高度:保证整个面板(含底栏 tab)始终在视口内,
  // 旧的 -48 会让拖存的位置在窗口变矮后底部大量溢出、看起来「塌陷」。
  const maxY = Math.max(0, window.innerHeight - size.value.h);
  return { x: Math.min(Math.max(x, 0), maxX), y: Math.min(Math.max(y, 0), maxY) };
}

function layout(): void {
  size.value = { w: Math.min(PANEL_W, window.innerWidth - 16), h: Math.round(window.innerHeight * PANEL_H_RATIO) };
  pos.value = settings.panelPos ? clampPos(settings.panelPos.x, settings.panelPos.y) : center();
}

/**
 * 窗口缩放专用布局:水平永远重新居中。
 * 否则窄屏占满时面板被钉在左/右缘(拖动还会把边缘位置存下),拉宽后就贴边不回中。
 * 纵向沿用保存的位置(仅越界拉回);结果一并落盘,下次打开仍居中。
 */
function layoutOnResize(): void {
  size.value = { w: Math.min(PANEL_W, window.innerWidth - 16), h: Math.round(window.innerHeight * PANEL_H_RATIO) };
  const savedY = settings.panelPos?.y ?? center().y;
  const x = Math.max(8, Math.round((window.innerWidth - size.value.w) / 2));
  pos.value = clampPos(x, savedY);
  settings.panelPos = { ...pos.value };
}

function center(): { x: number; y: number } {
  return {
    x: Math.max(8, Math.round((window.innerWidth - size.value.w) / 2)),
    y: Math.max(8, Math.round((window.innerHeight - size.value.h) / 2.4)),
  };
}

onMounted(layout);
onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});

/* 窗口缩放(含拖边变窄/变矮):rAF 节流重新布局,尺寸重算 + 水平重新居中,
   避免面板停留在旧尺寸旧位置(溢出/贴边)。 */
let resizeQueued = false;
function onWindowResize(): void {
  if (resizeQueued || !ui.panelOpen) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    layoutOnResize();
  });
}
onMounted(() => window.addEventListener('resize', onWindowResize));

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('resize', onWindowResize);
});
watch(
  () => ui.panelOpen,
  open => {
    if (open) layout();
  },
);

/** Esc 关闭窗口。 */
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && ui.panelOpen) closePanel();
}

/* ---- 外观:标题栏小圆钮,点击在 跟随酒馆 → 昼 → 夜 间循环 ---- */
const THEME_CYCLE: TlbTheme[] = ['st', 'day', 'night'];
const THEME_LABEL: Record<TlbTheme, string> = {
  st: '跟随酒馆',
  day: '昼 · 象牙白',
  night: '夜 · 海军黑',
};

function cycleTheme(): void {
  const i = THEME_CYCLE.indexOf(settings.theme);
  settings.theme = THEME_CYCLE[(i + 1) % THEME_CYCLE.length];
}

/* ---- 拖动(标题栏 pointer 事件) ---- */
let dragStart: { px: number; py: number; x: number; y: number } | null = null;

function onDragDown(e: PointerEvent): void {
  if ((e.target as HTMLElement).closest('button')) return;
  dragStart = { px: e.clientX, py: e.clientY, x: pos.value.x, y: pos.value.y };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onDragMove(e: PointerEvent): void {
  if (!dragStart) return;
  pos.value = clampPos(dragStart.x + (e.clientX - dragStart.px), dragStart.y + (e.clientY - dragStart.py));
}

function onDragUp(): void {
  if (!dragStart) return;
  dragStart = null;
  settings.panelPos = { ...pos.value };
}
</script>

<template>
  <div class="tlb-panel" :style="style">
    <div class="tlb-panel__head" @pointerdown="onDragDown" @pointermove="onDragMove" @pointerup="onDragUp" @pointercancel="onDragUp">
      <Icon name="flask" />
      <span class="tlb-panel__title">Tag 实验室</span>
      <span class="tlb-hint tlb-panel__ver">v{{ version }}</span>
      <button
        class="tlb-btn tlb-btn--bare tlb-btn--sm tlb-btn--icon"
        :title="`外观:${THEME_LABEL[settings.theme]}(点击切换)`"
        @click.stop="cycleTheme"
      >
        <Icon name="color-swatch" />
      </button>
      <button class="tlb-btn tlb-btn--bare tlb-btn--sm tlb-btn--icon" title="关闭 (Esc)" @click.stop="closePanel()">
        <Icon name="close" />
      </button>
    </div>

    <div class="tlb-panel__body tlb-scroll">
      <slot />
    </div>

    <div class="tlb-panel__tabs">
      <button
        v-for="tab in TABS"
        :key="tab.key"
        class="tlb-tab"
        :class="{ 'tlb-tab--on': ui.tab === tab.key }"
        @click.stop="ui.tab = tab.key"
      >
        <Icon :name="tab.icon" />
        <span>{{ tab.label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.tlb-panel {
  position: fixed;
  z-index: 10010;
  display: flex;
  flex-direction: column;
  background: var(--tlb-bg);
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius-win);
  box-shadow: var(--tlb-shadow);
  overflow: hidden;
  pointer-events: auto;
}

.tlb-panel__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--tlb-surface);
  border-bottom: 1px solid var(--tlb-line);
  cursor: grab;
  user-select: none;
  touch-action: none;
}

.tlb-panel__head:active {
  cursor: grabbing;
}

.tlb-panel__title {
  font-weight: 700;
  font-size: 14.5px;
}

.tlb-panel__ver {
  flex: 1;
}

.tlb-panel__body {
  flex: 1;
  min-height: 0;
  padding: 0 16px;
  pointer-events: auto;
}

.tlb-panel__tabs {
  display: flex;
  border-top: 1px solid var(--tlb-line);
  background: var(--tlb-surface);
}

.tlb-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 0;
  border: none;
  background: transparent;
  color: var(--tlb-ink-soft);
  font-size: 13px;
  cursor: pointer;
  transition: color var(--tlb-dur) var(--tlb-ease), background var(--tlb-dur) var(--tlb-ease);
}

.tlb-tab:hover {
  color: var(--tlb-ink);
  background: var(--tlb-surface-2);
}

.tlb-tab--on {
  color: var(--tlb-accent);
  font-weight: 700;
  box-shadow: inset 0 -2px 0 var(--tlb-accent);
}
</style>
