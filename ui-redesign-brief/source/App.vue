<script setup lang="ts">
/**
 * 根组件:主题容器 + 浮动面板(各页切换)。
 * 生成页常驻挂载(保留输入状态);画廊/设置按需挂载。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import FloatingPanel from '@/components/FloatingPanel.vue';
import ArtistCompare from '@/components/ArtistCompare.vue';
import GalleryCompareModal from '@/components/GalleryCompareModal.vue';
import GalleryPanel from '@/components/GalleryPanel.vue';
import GenPanel from '@/components/GenPanel.vue';
import PreviewModal from '@/components/PreviewModal.vue';
import SettingsPanel from '@/components/SettingsPanel.vue';
import WatermarkStudio from '@/components/WatermarkStudio.vue';
import { loadHistory } from '@/state/historyList';
import { loadVibes } from '@/state/vibeList';
import { loadArtistPreviews } from '@/state/artistPreviews';
import { settings } from '@/state/settings';
import { ui } from '@/state/ui';

const theme = computed(() => settings.theme);
const rootEl = ref<HTMLElement | null>(null);

/**
 * ST 主题的 surface 取自宿主 --SmartThemeChatTintColor,该色带 alpha。
 * 读自定义属性只会拿到原始 token 文本(var(...)/color-mix(...)),必须挂一个
 * 探针元素、让浏览器把 var 解析成真实 rgba 后读 backgroundColor,再按亮度把
 * alpha 拍平到白/深底上,生成不透明令牌(--tlb-surface-opaque / --tlb-surface-2-opaque)。
 */
function flattenRgba(raw: string): string | null {
  const m = raw.trim().match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,]+([\d.]+))?\s*\)$/i);
  if (!m) return null;
  const rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
  const a = m[4] === undefined ? 1 : Number(m[4]);
  if (a >= 0.999) return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  const lin = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(rgb[0] / 255) + 0.7152 * lin(rgb[1] / 255) + 0.0722 * lin(rgb[2] / 255);
  const base = L > 0.5 ? [255, 255, 255] : [40, 40, 48]; // 浅色压白底,深色压深底
  const out = rgb.map((c, i) => Math.round(c * a + base[i] * (1 - a)));
  return `rgb(${out[0]}, ${out[1]}, ${out[2]})`;
}

/** 把元素上的某个颜色类 CSS 变量解析成 rgba(探针法,自定义属性无法直接读到解析值)。 */
function resolveTokenColor(token: string): string | null {
  const el = rootEl.value;
  if (!el) return null;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;width:1px;height:1px;top:-999px;left:-999px;visibility:hidden;pointer-events:none;';
  probe.style.backgroundColor = `var(${token})`;
  el.appendChild(probe);
  const resolved = getComputedStyle(probe).backgroundColor;
  el.removeChild(probe);
  const flat = flattenRgba(resolved);
  return flat ?? null;
}

/** 解析彻底失败时的保底:昼主题白、夜主题深、ST 跟随用白底。 */
const OPAQUE_FALLBACK: Record<string, [string, string]> = {
  day: ['rgb(255,255,255)', 'rgb(241,240,237)'],
  night: ['#44444E', '#4E4D58'],
  st: ['rgb(255,255,255)', 'rgb(242,241,239)'],
};

function syncOpaqueTokens(): void {
  const el = rootEl.value;
  if (!el) return;
  const fb = OPAQUE_FALLBACK[settings.theme] ?? OPAQUE_FALLBACK.st;
  const surface = resolveTokenColor('--tlb-surface') ?? fb[0];
  const surface2 = resolveTokenColor('--tlb-surface-2') ?? fb[1];
  el.style.setProperty('--tlb-surface-opaque', surface);
  el.style.setProperty('--tlb-surface-2-opaque', surface2);
}

onMounted(() => {
  void loadHistory(); // 启动即载一次,画廊/回填直接可用
  void loadVibes(); // vibe 列表,生成时叠加用
  void loadArtistPreviews(); // 同步导入的画师串预览图缓存
  void nextTick(syncOpaqueTokens);
});

// 主题切换后重算
watch(theme, () => void nextTick(syncOpaqueTokens), { flush: 'post' });
// 宿主主题变量可能晚于本组件就绪/外部随时切换:每次打开预览前再算一次
watch(
  [() => ui.previewOpen, () => ui.watermarkStudio.open],
  opens => {
    if (opens.some(Boolean)) void nextTick(syncOpaqueTokens);
  },
  { flush: 'post' },
);
</script>

<template>
  <div ref="rootEl" class="tlb-root" :data-theme="theme">
    <FloatingPanel v-if="ui.panelOpen">
      <GenPanel v-show="ui.tab === 'gen'" />
      <ArtistCompare v-if="ui.tab === 'compare'" />
      <GalleryPanel v-if="ui.tab === 'gallery'" />
      <SettingsPanel v-if="ui.tab === 'settings'" />
    </FloatingPanel>
    <PreviewModal v-if="ui.previewOpen" />
    <GalleryCompareModal />
    <WatermarkStudio v-if="ui.watermarkStudio.open" />
  </div>
</template>
