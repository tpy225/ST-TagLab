<script setup lang="ts">
/**
 * 输入框右上角的「复制 / 清空 / 放大」按钮组。
 * 所有输入框(画师串 / 正面词 / 负面词)共用这一组,改样式一处即全部更新。
 * 定位由父级 .tlb-fieldbox(position:relative) 决定;这里 absolute 贴在右上角。
 */
import Icon from '@/components/Icon.vue';

defineEmits<{ copy: []; clear: []; zoom: [] }>();
</script>

<template>
  <div class="tlb-ia">
    <button class="tlb-btn tlb-btn--bare tlb-ia__btn" type="button" title="复制" @click="$emit('copy')">
      <Icon name="copy" />
    </button>
    <button class="tlb-btn tlb-btn--bare tlb-ia__btn" type="button" title="清空" @click="$emit('clear')">
      <Icon name="eraser" />
    </button>
    <button class="tlb-btn tlb-btn--bare tlb-ia__btn" type="button" title="放大" @click="$emit('zoom')">
      <Icon name="maximize" />
    </button>
  </div>
</template>

<style scoped>
/* 悬浮条:默认隐藏且不占位,文字可铺满整行;
   hover 整个输入框 / 输入框聚焦(点击进入)时才浮现。
   隐藏时 pointer-events:none,不会挡住右上角的文字选择。 */
.tlb-ia {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  display: flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius-pill);
  background: color-mix(in srgb, var(--tlb-surface-2) 82%, transparent);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.14);
  opacity: 0;
  pointer-events: none;
  transform: translateY(-2px);
  transition: opacity var(--tlb-dur) var(--tlb-ease), transform var(--tlb-dur) var(--tlb-ease);
}

.tlb-fieldbox:hover .tlb-ia,
.tlb-fieldbox:focus-within .tlb-ia {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.tlb-ia__btn {
  width: 22px;
  height: 22px;
  padding: 0;
  font-size: 13px;
}
</style>