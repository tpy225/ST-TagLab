<script setup lang="ts">
/**
 * 自製下拉:原生 select 的彈出選單無法配色,統一用這個。
 * v-model 綁值;另發 change(值) 給需要副作用的場景。
 * 外觀吃 .tlb-select 與傳入 class,各主題自動跟隨。
 *
 * 彈層 Teleport 到 .tlb-root 下的共享 overlay 層、position:fixed 定位:
 * 浮窗 .tlb-panel 有 overflow:hidden,彈層放內部必被裁剪/遮擋。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

import Icon from '@/components/Icon.vue';

interface Option {
  value: string | number;
  label: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string | number;
    options: Option[];
    disabled?: boolean;
    title?: string;
  }>(),
  { disabled: false, title: undefined },
);

const emit = defineEmits<{
  'update:modelValue': [value: string | number];
  change: [value: string | number];
}>();

const open = ref(false);
const controlEl = ref<HTMLButtonElement | null>(null);
const menuEl = ref<HTMLUListElement | null>(null);
const overlayEl = ref<HTMLElement | null>(null);
const menuStyle = ref<Record<string, string>>({});
const current = computed(() => props.options.find(o => o.value === props.modelValue));

/* .tlb-root 下共享一個 overlay 容器(所有 TlbSelect 實例複用) */
function ensureOverlay(root: HTMLElement): HTMLElement {
  let el = root.querySelector<HTMLElement>(':scope > .tlb-selectdd__overlay');
  if (!el) {
    el = document.createElement('div');
    el.className = 'tlb-selectdd__overlay';
    /* 動態建立無 scoped 屬性,這層樣式用 inline;自身不攔事件,由 mask/menu 自行開啟 */
    el.style.cssText = 'position:fixed;inset:0;z-index:100000;pointer-events:none;';
    root.appendChild(el);
  }
  return el;
}

function placeMenu(): void {
  const btn = controlEl.value;
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const h = menuEl.value?.offsetHeight ?? 0;
  const gap = 3;
  const spaceBelow = window.innerHeight - r.bottom;
  const spaceAbove = r.top;
  const flipUp = h > 0 && spaceBelow < h + gap + 8 && spaceAbove > spaceBelow;
  menuStyle.value = {
    position: 'fixed',
    left: `${r.left}px`,
    top: flipUp ? `${r.top - h - gap}px` : `${r.bottom + gap}px`,
    minWidth: `${r.width}px`,
    maxWidth: '86vw',
  };
}

function closeOnScroll(): void {
  open.value = false;
}

watch(open, async (v) => {
  if (v) {
    const root = controlEl.value?.closest<HTMLElement>('.tlb-root');
    overlayEl.value = root ? ensureOverlay(root) : null;
    await nextTick();
    placeMenu();
    /* 面板內容滾動即收起(捕獲階段攔截);視口尺寸變化重新定位 */
    window.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('resize', placeMenu);
    window.visualViewport?.addEventListener('resize', placeMenu);
  } else {
    window.removeEventListener('scroll', closeOnScroll, true);
    window.removeEventListener('resize', placeMenu);
    window.visualViewport?.removeEventListener('resize', placeMenu);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('scroll', closeOnScroll, true);
  window.removeEventListener('resize', placeMenu);
  window.visualViewport?.removeEventListener('resize', placeMenu);
});

function toggle(): void {
  if (props.disabled) return;
  open.value = !open.value;
}

function pick(value: string | number): void {
  emit('update:modelValue', value);
  emit('change', value);
  open.value = false;
}
</script>

<template>
  <div class="tlb-selectdd" :class="{ 'is-open': open, 'is-disabled': disabled }">
    <button
      ref="controlEl"
      type="button"
      class="tlb-select tlb-selectdd__control"
      :disabled="disabled"
      :title="title"
      @click="toggle"
      @keydown.esc="open = false"
    >
      <span class="tlb-selectdd__label">{{ current?.label ?? '' }}</span>
      <Icon :name="open ? 'chevron-up' : 'chevron-down'" :size="13" class="tlb-selectdd__chevron" />
    </button>
    <Teleport v-if="open && overlayEl" :to="overlayEl">
      <div class="tlb-selectdd__mask" @click="open = false" />
      <ul
        ref="menuEl"
        class="tlb-selectdd__menu tlb-scroll"
        :style="menuStyle"
      >
        <li
          v-for="o in options"
          :key="o.value"
          class="tlb-selectdd__item"
          :class="{ 'is-active': o.value === modelValue }"
          @click="pick(o.value)"
        >
          {{ o.label }}
        </li>
      </ul>
    </Teleport>
  </div>
</template>

<style scoped>
.tlb-selectdd {
  position: relative;
  display: flex;
  width: 100%;
}

.tlb-selectdd.is-disabled {
  opacity: 0.55;
}

/* 共享 overlay:.tlb-root 直接子層,脫離 .tlb-panel 的 overflow:hidden */
.tlb-selectdd__overlay {
  position: fixed;
  inset: 0;
  z-index: 100000;
  pointer-events: none;
}

/* 控制鈕沿用 .tlb-select 的框/底/字級,僅去掉原生箭頭背景 */
.tlb-selectdd__control {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  text-align: left;
  background-image: none;
}

.tlb-selectdd__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tlb-selectdd__chevron {
  flex: none;
  opacity: 0.75;
}

.tlb-selectdd__mask {
  position: fixed;
  inset: 0;
  z-index: 100000;
  pointer-events: auto;
}

.tlb-selectdd__menu {
  z-index: 100001;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--tlb-surface);
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius-sm);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
  pointer-events: auto;
  max-height: 220px;
  overflow-y: auto;
}

.tlb-selectdd__item {
  padding: 6px 10px;
  border-radius: calc(var(--tlb-radius-sm) - 1px);
  font-size: 12.5px;
  color: var(--tlb-ink);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tlb-selectdd__item:hover {
  background: var(--tlb-accent-soft);
}

.tlb-selectdd__item.is-active {
  color: var(--tlb-accent);
  font-weight: 700;
}
</style>
