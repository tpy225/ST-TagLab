<script setup lang="ts">
import { computed } from 'vue';

/**
 * 内联 SVG 图标 —— 不依赖字体库,天然跨 shadow DOM(参考柏宝绘 Icon.vue)。
 * 统一 24×24 视框、描边风格(currentColor + stroke),
 * 颜色随 CSS color、尺寸随 font-size(默认 1em)。
 * spin=true 时旋转(加载态)。新增图标:往 PATHS 加一条 name -> 标记。
 */
const props = defineProps<{ name: string; size?: number | string; spin?: boolean }>();

const PATHS: Record<string, string> = {
  // 基础操作
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="M5 12.5 10 17.5 19 7"/>',
  save:
    '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  copy:
    '<rect x="8" y="8" width="11" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v10A1.5 1.5 0 0 0 5.5 17H8"/>',
  trash: '<path d="M4 6.5h16M9.5 6.5v-2h5v2M6.5 6.5l.9 13h9.2l.9-13"/>',
  /* 拖柄:六点,fill=currentColor */
  grip: '<g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></g>',
  eraser:
    '<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  edit: '<path d="M4.5 19.5h4L19 9 15 5 4.5 15.5z"/><path d="M13 7 17 11"/>',
  /* 重命名(铅笔,Phosphor 填充风,256 视框经 scale 缩入 24;fill=currentColor) */
  rename:
    '<g transform="scale(0.09375)" fill="currentColor" stroke="none"><path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM51.31,160l90.35-90.35,16.68,16.69L68,176.68ZM48,179.31,76.69,208H48Zm48,25.38L79.31,188l90.35-90.35h0l16.68,16.69Z"/></g>',
  ban: '<circle cx="12" cy="12" r="9.5"/><path d="m5.5 5.5 13 13"/>',
  search: '<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  refresh:
    '<path d="M20 11a8 8 0 0 0-14-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14 4.5L20 16"/><path d="M20 20v-4h-4"/>',
  maximize:
    '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  login:
    '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
  reply: '<path d="M9 17l-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  // 箭头
  'chevron-down': '<path d="M6 9.5 12 15.5 18 9.5"/>',
  'chevron-up': '<path d="M6 14.5 12 8.5 18 14.5"/>',
  'chevron-left': '<path d="M14.5 6 8.5 12l6 6"/>',
  'chevron-right': '<path d="M9.5 6 15.5 12l-6 6"/>',
  'arrow-left': '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
  // 图片 / 媒体
  image:
    '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4 17.5 10 12l4 4 3-3 3.5 3.5"/>',
  gallery:
    '<path d="M7.5 3.5H19A1.5 1.5 0 0 1 20.5 5v11"/><rect x="3.5" y="6.5" width="13.5" height="12" rx="1.5"/><circle cx="7.3" cy="10.3" r="1.2"/><path d="M4 15.8 8 12l2.8 2.8 2-2 3.7 3.7"/>',
  // AI / 生成
  wand:
    '<path d="M6 21 17.5 9.5"/><path d="M15 4.5v3M15 12v.5M19.5 9h-3M11 9h-.5M17.7 5.3l-1.4 1.4M17.7 12.7l-1.4-1.4M12.3 5.3l1.4 1.4"/>',
  sparkles:
    '<path d="M12 4c.6 3.4 1.6 4.4 5 5-3.4.6-4.4 1.6-5 5-.6-3.4-1.6-4.4-5-5 3.4-.6 4.4-1.6 5-5z"/><path d="M18.5 14c.3 1.5.7 1.9 2.2 2.2-1.5.3-1.9.7-2.2 2.2-.3-1.5-.7-1.9-2.2-2.2 1.5-.3 1.9-.7 2.2-2.2z"/>',
  /* AI 生成(Tabler ai,24 描边风,随父级 stroke=currentColor) */
  ai: '<path d="M8 16v-6a2 2 0 1 1 4 0v6"/><path d="M8 13h4"/><path d="M16 8v8"/>',
  /* NAI 生成(lucide wand-sparkles,24 描边风,随父级 stroke=currentColor) */
  'wand-sparkles':
    '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  robot:
    '<rect x="4" y="8" width="16" height="11" rx="2.5"/><path d="M12 8V4"/><path d="M8.5 4h2.5"/><path d="M9 13h.01M15 13h.01"/><path d="M2 13v2M22 13v2"/><path d="M12 19v3"/>',
  // 文件 / 进出
  download:
    '<path d="M12 4v11"/><path d="M8 11l4 4 4-4"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  upload:
    '<path d="M12 15V4"/><path d="M8 8l4-4 4 4"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  import:
    '<path d="M12 14V3"/><path d="m8 7 4 4 4-4"/><path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  export:
    '<path d="M12 11V2"/><path d="m8 6 4-4 4 4"/><path d="M4 11v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8"/>',
  'file-down':
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/>',
  'file-up':
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/><path d="M12 15V9"/><path d="m9 12 3-3 3 3"/>',
  external:
    '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>',
  bookmark: '<path d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3.2L6 20V5.5a1 1 0 0 1 1-1z"/>',
  archive:
    '<rect x="2.5" y="3.5" width="19" height="4.5" rx="1"/><path d="M4.5 8v11a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V8"/><path d="M10 12h4"/>',
  // 配置 / 服务
  server:
    '<rect x="2.5" y="3.5" width="19" height="7" rx="1.5"/><rect x="2.5" y="13.5" width="19" height="7" rx="1.5"/><path d="M6.5 7h.01M6.5 17h.01"/>',
  plug: '<path d="M9 3v5M15 3v5"/><path d="M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0z"/><path d="M12 17v4"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><path d="M7 7h.01"/>',
  /* 外观(Tabler color-swatch,24 描边风) */
  'color-swatch':
    '<path d="M19 3h-4a2 2 0 0 0 -2 2v12a4 4 0 0 0 8 0v-12a2 2 0 0 0 -2 -2"/><path d="M13 7.35l-2 -2a2 2 0 0 0 -2.828 0l-2.828 2.828a2 2 0 0 0 0 2.828l9 9"/><path d="M7.3 13h-2.3a2 2 0 0 0 -2 2v4a2 2 0 0 0 2 2h12"/><path d="M17 17l0 .01"/>',
  brush:
    '<path d="M9.5 14.5 4 20a2.1 2.1 0 0 1-3-3l5.5-5.5"/><path d="M14.5 4.5 19.5 9.5 11 18a3 3 0 0 1-4.2 0l-.8-.8a3 3 0 0 1 0-4.2z"/><path d="m13 6 5 5"/>',
  database:
    '<ellipse cx="12" cy="5" rx="8.5" ry="2.8"/><path d="M3.5 5v14c0 1.5 3.8 2.8 8.5 2.8s8.5-1.3 8.5-2.8V5"/><path d="M3.5 12c0 1.5 3.8 2.8 8.5 2.8s8.5-1.3 8.5-2.8"/>',
  settings:
    '<path d="M5 8h9M18 8h1"/><path d="M5 16h1M10 16h9"/><circle cx="16" cy="8" r="2.2"/><circle cx="8" cy="16" r="2.2"/>',
  layers:
    '<path d="m12 3 8.5 4.5L12 12 3.5 7.5z"/><path d="m3.5 12 8.5 4.5 8.5-4.5"/><path d="m3.5 16.5 8.5 4.5 8.5-4.5"/>',
  flask:
    '<path d="M10 2v6L4.2 18.5A2 2 0 0 0 6 21.5h12a2 2 0 0 0 1.8-3L14 8V2"/><path d="M8.5 2h7"/><path d="M7 15.5h10"/>',
  stamp:
    '<path d="M9 2h6v5a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z"/><path d="M6.5 13h11l-1.2 4.5H7.7z"/><path d="M4 21h16M5.5 17.5h13"/>',
  'cloud-down':
    '<path d="M12 13v8"/><path d="m8.5 17.5 3.5 3.5 3.5-3.5"/><path d="M20.4 14.5A4.5 4.5 0 0 0 16.5 6h-1.8A7 7 0 1 0 4 15.3"/>',
  'cloud-up':
    '<path d="M12 20v-8"/><path d="m8.5 15.5 3.5-3.5 3.5 3.5"/><path d="M20.4 15.5A4.5 4.5 0 0 0 16.5 7h-1.8A7 7 0 1 0 4 16.3"/>',
  /* 文件导出/导入(对齐 fa-file-export / fa-file-import:文档+右出/右入箭头) */
  /* 导出(Phosphor upload-simple 填充风,256 视框经 scale 缩入 24;fill=currentColor) */
  'file-export':
    '<g transform="scale(0.09375)" fill="currentColor" stroke="none"><path d="M216,112v96a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V112A16,16,0,0,1,56,96H80a8,8,0,0,1,0,16H56v96H200V112H176a8,8,0,0,1,0-16h24A16,16,0,0,1,216,112Z"/><path d="M93.66,69.66,120,43.31V136a8,8,0,0,0,16,0V43.31l26.34,26.35a8,8,0,0,0,11.32-11.32l-40-40a8,8,0,0,0-11.32,0l-40,40A8,8,0,0,0,93.66,69.66Z"/></g>',
  /* 导入(Tabler file-import 描边风,24 视框,随父级 stroke=currentColor) */
  'file-import':
    '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M5 13v-8a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2h-5.5"/><path d="M2 19h7"/><path d="m6 16 3 3-3 3"/>',
  // 反馈
  'info': '<circle cx="12" cy="12" r="9.5"/><path d="M12 10.8v5.2"/><path d="M12 7.6h.01"/>',
  warning:
    '<path d="M10.3 4 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4"/><path d="M12 17.5h.01"/>',
  // 加载(配合 spin)
  loader: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/>',
};

const inner = computed(() => PATHS[props.name] ?? '');
const dim = computed(() => (props.size ? (typeof props.size === 'number' ? `${props.size}px` : props.size) : '1em'));
</script>

<template>
  <svg
    class="tlb-icon"
    :class="{ 'tlb-icon--spin': spin }"
    :style="{ width: dim, height: dim }"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="inner"
  />
</template>

<style scoped>
.tlb-icon {
  display: inline-block;
  flex: 0 0 auto;
  vertical-align: -0.14em;
}

.tlb-icon--spin {
  animation: tlb-icon-spin 0.9s linear infinite;
}

@keyframes tlb-icon-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
