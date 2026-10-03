<script setup lang="ts">
/**
 * 自製下拉:原生 select 的彈出選單無法配色,統一用這個。
 * v-model 綁值;另發 change(值) 給需要副作用的場景。
 * 外觀吃 .tlb-select 與傳入 class,各主題自動跟隨。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';

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
const rootEl = ref<HTMLElement | null>(null);
const current = computed(() => props.options.find(o => o.value === props.modelValue));

/* 彈層逃不出 .tlb-panel 的層疊上下文;打開期間把整個浮窗抬高到宿主 UI 之上,關閉復原 */
const OPEN_Z = '100000';

function panelEl(): HTMLElement | null {
  return rootEl.value?.closest<HTMLElement>('.tlb-panel') ?? null;
}

function liftPanel(on: boolean): void {
  const p = panelEl();
  if (!p) return;
  if (on) {
    if (!p.dataset.tlbPrevZ) p.dataset.tlbPrevZ = p.style.zIndex || getComputedStyle(p).zIndex;
    p.style.zIndex = OPEN_Z;
  } else {
    p.style.zIndex = p.dataset.tlbPrevZ ?? '';
    delete p.dataset.tlbPrevZ;
  }
}

watch(open, v => liftPanel(v));
onBeforeUnmount(() => {
  if (open.value) liftPanel(false);
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
  <div ref="rootEl" class="tlb-selectdd" :class="{ 'is-open': open, 'is-disabled': disabled }">
    <button
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
    <div v-if="open" class="tlb-selectdd__mask" @click="open = false" />
    <ul v-if="open" class="tlb-selectdd__menu tlb-scroll">
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
  z-index: 40;
}

.tlb-selectdd__menu {
  position: absolute;
  top: calc(100% + 3px);
  left: 0;
  right: 0;
  z-index: 41;
  max-height: 220px;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--tlb-surface);
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius-sm);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
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
