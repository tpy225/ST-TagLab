<script setup lang="ts">
/**
 * 画廊页:历史网格。
 *
 * 三种模式:
 * - view(默认):点图 → 预览弹窗;hover 显示单张删除。
 * - batch:点「批量管理」进入;图片不放大,点任意位置切换选中(高亮);
 *   工具栏展开 全选 / 下载 / 删除;「完成」退出。
 * - compare:点「多图对比」进入;选取规则同上;「开始对比」在点击时校验 2–4 张。
 *
 * 下载文件名 taglab_s{seed}.{ext}(原 png/jpg)。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue';

import { history, loadHistory, removeHistory, wipeHistory, allImageTags, batchAddTags, batchToggleTag, parseTags } from '@/state/historyList';
import { imageUrl, ui } from '@/state/ui';
import { notify } from '@/st/toast';
import Icon from '@/components/Icon.vue';
import { useIsMobile } from '@/use/useIsMobile';

const isMobile = useIsMobile();

onMounted(() => {
  if (!history.loaded) void loadHistory();
});

type GalMode = 'view' | 'batch' | 'compare';

const mode = ref<GalMode>('view');
const selected = ref<string[]>([]);

/** 列表。 */
const tagQuery = ref('');

const shown = computed(() => {
  const q = tagQuery.value.trim().toLowerCase();
  if (!q) return history.items;
  return history.items.filter(i => (i.tags ?? []).some(t => t.toLowerCase().includes(q)));
});

/* 查询变化后,剔除不可见的已选项,避免批量操作误处理隐藏图 */
watch(shown, items => {
  const ids = new Set(items.map(i => i.id));
  selected.value = selected.value.filter(id => ids.has(id));
});

/** 图卡显示标签:搜索命中的排前,其余保持原顺序;默认显示前 3 个,hover 展开全部。 */
function displayTags(item: { tags?: string[] }): string[] {
  const tags = item.tags ?? [];
  const q = tagQuery.value.trim().toLowerCase();
  if (!q) return tags;
  const hit = tags.filter(t => t.toLowerCase().includes(q));
  return [...hit, ...tags.filter(t => !t.toLowerCase().includes(q))];
}

const picking = computed(() => mode.value !== 'view');
const isSelected = (id: string): boolean => selected.value.includes(id);

/** id → object URL(会话级缓存)。有缩略图的条目不读全图,仅无缩略图旧记录按需回落。 */
const urls = reactive<Record<string, string>>({});

watch(
  () => history.items,
  async items => {
    for (const item of items) {
      if (item.thumb) continue;
      if (!urls[item.id]) {
        const url = await imageUrl(item.id);
        if (url) urls[item.id] = url;
      }
    }
  },
  { immediate: true, deep: true },
);

/* ══════════════ 模式切换 ══════════════ */

function enterMode(next: GalMode): void {
  if (mode.value === next) return;
  mode.value = next;
  selected.value = [];
  confirmDeleteOpen.value = false;
  tagPopOpen.value = false;
}

function exitMode(): void {
  mode.value = 'view';
  selected.value = [];
  confirmDeleteOpen.value = false;
  tagPopOpen.value = false;
}

/* ══════════════ 点单元格 ══════════════ */

function onCellClick(id: string): void {
  if (picking.value) {
    if (isSelected(id)) selected.value = selected.value.filter(x => x !== id);
    else selected.value.push(id);
    confirmDeleteOpen.value = false;
  } else {
    ui.currentId = id;
    ui.previewOpen = true;
  }
}

const isAllSelected = computed(
  () => shown.value.length > 0 && selected.value.length === shown.value.length,
);

/** 全选 / 取消全选(同一键切换)。 */
function toggleAll(): void {
  selected.value = isAllSelected.value ? [] : shown.value.map(i => i.id);
}

/* ══════════════ 单张 / 清空 ══════════════ */

async function removeOne(id: string): Promise<void> {
  await removeHistory(id);
  selected.value = selected.value.filter(x => x !== id);
}

async function clearAll(): Promise<void> {
  if (!window.confirm('清空全部历史(含图片)?此操作不可恢复。')) return;
  await wipeHistory();
  exitMode();
  notify('success', '历史已清空');
}

/* ══════════════ 批量下载 ══════════════ */

function extOf(meta: { mime: string }): string {
  return (meta.mime.split('/')[1] || 'png').replace('jpeg', 'jpg');
}

/** 批量下载原图:串行触发(浏览器可能询问「允许下载多个文件」),保留原 png/jpg。 */
async function batchDownload(): Promise<void> {
  const metas = shown.value.filter(i => selected.value.includes(i.id));
  if (!metas.length) return;
  let done = 0;
  for (const meta of metas) {
    const u = await imageUrl(meta.id);
    if (!u) {
      notify('error', `图片 ${meta.id.slice(0, 8)} 读取失败,已跳过`);
      continue;
    }
    const a = document.createElement('a');
    a.href = u;
    a.download = `taglab_s${meta.seed}.${extOf(meta)}`;
    a.click();
    done += 1;
    await new Promise(r => setTimeout(r, 350)); // 给浏览器排队,避免吞掉后续下载
  }
  notify('success', `已开始下载 ${done} 张原图`);
}

/* ══════════════ 批量删除:两步确认 ══════════════ */

const confirmDeleteOpen = ref(false);

function askBatchDelete(): void {
  if (selected.value.length) confirmDeleteOpen.value = true;
}

async function batchDelete(): Promise<void> {
  const ids = [...selected.value];
  confirmDeleteOpen.value = false;
  for (const id of ids) await removeHistory(id);
  selected.value = [];
  notify('success', `已删除 ${ids.length} 张`);
}

/* ══════════════ 开始对比:点击时才校验 2–4 张 ══════════════ */

const MAX_COMPARE = 4;

function startCompare(): void {
  if (selected.value.length < 2) {
    notify('warning', '先点选 2–4 张图片');
    return;
  }
  if (selected.value.length > MAX_COMPARE) {
    notify('warning', `对比最多 ${MAX_COMPARE} 张,请取消多余勾选(${selected.value.length} 张已选)`);
    return;
  }
  ui.galleryCompare.ids = [...selected.value];
  ui.galleryCompare.open = true;
}

/* ══════════════ 批量标签 ══════════════ */
const tagPopOpen = ref(false);
const tagInput = ref('');

const selectedItems = computed(() => shown.value.filter(i => selected.value.includes(i.id)));

/** 选中项全部都有的标签。 */
const commonTags = computed(() => {
  const items = selectedItems.value;
  if (!items.length) return [];
  return allImageTags.value.filter(t => items.every(i => (i.tags ?? []).includes(t)));
});

/** 只有部分选中项有的标签(混合态)。 */
const partialTags = computed(() => {
  const items = selectedItems.value;
  if (items.length < 2) return [];
  return allImageTags.value.filter(
    t => !commonTags.value.includes(t) && items.some(i => (i.tags ?? []).includes(t)),
  );
});

async function toggleBatchTag(tag: string): Promise<void> {
  await batchToggleTag(selected.value, tag);
}

async function submitBatchTags(): Promise<void> {
  const tags = parseTags(tagInput.value);
  if (!tags.length) return;
  await batchAddTags(selected.value, tags);
  tagInput.value = '';
  notify('success', `已加到 ${selected.value.length} 张图片`);
}

/** 開水印工坊,帶入目前選取。 */
function openBatchWatermark(): void {
  if (!selected.value.length) return;
  ui.watermarkStudio.ids = [...selected.value];
  ui.watermarkStudio.open = true;
}
</script>

<template>
  <div class="tlb-gal" :class="{ 'tlb-gal--mobile': isMobile }">
    <!-- 工具栏 -->
    <div class="tlb-gal__toolbar">
      <!-- 默认:两个入口键 -->
      <div v-if="mode === 'view'" class="tlb-row tlb-row--wrap tlb-gal__toolbar-row">
        <button class="tlb-btn tlb-btn--sm" @click="enterMode('batch')">
          <Icon name="settings" /> 批量管理
        </button>
        <button class="tlb-btn tlb-btn--sm tlb-btn--accent" @click="enterMode('compare')">
          <Icon name="layers" /> 多图对比
        </button>
        <input
          v-model="tagQuery"
          class="tlb-input tlb-gal__find"
          placeholder="以 #標籤 篩選"
          title="輸入標籤關鍵字篩選圖片"
        />
        <span class="tlb-grow" />
        <span class="tlb-hint">{{ shown.length }} 张 · 点图预览</span>
        <button v-if="history.items.length" class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-gal__clearall" @click="clearAll">清空全部</button>
      </div>

      <!-- 批量管理展开:全选 / 下载 / 删除 / 完成 -->
      <div v-else-if="mode === 'batch'" class="tlb-row tlb-row--wrap tlb-gal__toolbar-row">
        <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" @click="toggleAll">
          {{ isAllSelected ? '取消全选' : '全选' }}
        </button>
        <button class="tlb-btn tlb-btn--sm" :disabled="!selected.length" @click="batchDownload">
          <Icon name="download" /> 下载{{ selected.length ? ` (${selected.length})` : '' }}
        </button>

        <!-- 批量标签 -->
        <div class="tlb-gal__tagwrap">
          <button
            class="tlb-btn tlb-btn--sm"
            :disabled="!selected.length"
            @click="tagPopOpen = !tagPopOpen"
          >
            <Icon name="tag" /> 標籤{{ commonTags.length ? ` (${commonTags.length})` : '' }}
          </button>
          <template v-if="tagPopOpen">
            <div class="tlb-gal__tagscrim" @click="tagPopOpen = false" />
            <div class="tlb-gal__tagpop">
              <input
                v-model="tagInput"
                class="tlb-input tlb-gal__taginput"
                placeholder="輸入標籤，逗號分隔，Enter 加到選取"
                @keydown.enter.prevent="submitBatchTags"
              />
              <div class="tlb-gal__taglist tlb-scroll">
                <button
                  v-for="t in allImageTags"
                  :key="t"
                  type="button"
                  class="tlb-tagchip"
                  :class="{
                    'tlb-tagchip--on': commonTags.includes(t),
                    'tlb-tagchip--partial': partialTags.includes(t),
                  }"
                  @click="toggleBatchTag(t)"
                >
                  <template v-if="commonTags.includes(t)">
                    #{{ t }} <Icon name="close" :size="9" />
                  </template>
                  <template v-else>
                    <Icon name="plus" :size="9" /> {{ t }}
                  </template>
                </button>
                <span v-if="!allImageTags.length" class="tlb-gal__tagempty">尚無標籤，先在上方輸入</span>
              </div>
              <span class="tlb-gal__taghint">半透明＝全部都有；虛框＝部分有；點擊為全部加入／移除</span>
            </div>
          </template>
        </div>

        <button class="tlb-btn tlb-btn--sm" :disabled="!selected.length" @click="openBatchWatermark">
          <Icon name="stamp" /> 水印工坊
        </button>

        <div class="tlb-gal__confirm-wrap">
          <button class="tlb-btn tlb-btn--sm tlb-btn--danger" :disabled="!selected.length" @click="askBatchDelete">
            <Icon name="trash" /> 删除{{ selected.length ? ` (${selected.length})` : '' }}
          </button>
          <div v-if="confirmDeleteOpen" class="tlb-gal__confirm">
            <span class="tlb-gal__confirm-text">确认删除选中的 <b>{{ selected.length }}</b> 张?不可恢复</span>
            <span class="tlb-gal__confirm-btns">
              <button class="tlb-btn tlb-btn--sm" @click="confirmDeleteOpen = false">取消</button>
              <button class="tlb-btn tlb-btn--sm tlb-btn--danger" @click="batchDelete">确认删除</button>
            </span>
          </div>
        </div>
        <span class="tlb-grow" />
        <span class="tlb-hint">点击图片任意位置选取({{ selected.length }}/{{ shown.length }})</span>
        <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" @click="exitMode">完成</button>
      </div>

      <!-- 对比选取展开:开始对比 / 完成(不提供全选) -->
      <div v-else class="tlb-row tlb-row--wrap tlb-gal__toolbar-row">
        <button
          class="tlb-btn tlb-btn--sm tlb-btn--accent"
          :class="{ 'tlb-gal__btn--warn': selected.length > MAX_COMPARE }"
          :disabled="selected.length < 2"
          @click="startCompare"
        >
          <Icon name="layers" /> 开始对比{{ selected.length ? ` (${selected.length})` : '' }}
        </button>
        <span class="tlb-grow" />
        <span class="tlb-hint">
          {{ selected.length > MAX_COMPARE ? `已选 ${selected.length} 张,对比最多 ${MAX_COMPARE} 张` : `点选 2–${MAX_COMPARE} 张(已选 ${selected.length})` }}
        </span>
        <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" @click="exitMode">完成</button>
      </div>
    </div>

    <!-- 网格 -->
    <div v-if="shown.length" class="tlb-gal__grid tlb-scroll" :class="{ 'is-picking': picking }">
      <figure
        v-for="item in shown"
        :key="item.id"
        class="tlb-gal__cell"
        :class="{ 'tlb-gal__cell--on': isSelected(item.id) }"
        @click="onCellClick(item.id)"
      >
        <img v-if="item.thumb || urls[item.id]" :src="item.thumb || urls[item.id]" alt="" loading="lazy" />
        <div v-else class="tlb-gal__ph"><Icon name="loader" spin /></div>
        <figcaption v-if="item.tags?.length" class="tlb-gal__cap">
          <span
            v-for="(t, idx) in displayTags(item)"
            :key="t"
            class="tlb-gal__tag"
            :class="{ 'tlb-gal__tag--extra': idx >= 3 }"
          >#{{ t }}</span>
        </figcaption>

        <!-- 选中角标(仅选取模式) -->
        <span v-if="picking && isSelected(item.id)" class="tlb-gal__pickbadge"><Icon name="check" :size="13" /></span>

        <!-- 默认模式:hover 单张删除 -->
        <button v-if="!picking" class="tlb-gal__del" title="删除" @click.stop="removeOne(item.id)">
          <Icon name="trash" />
        </button>
      </figure>
    </div>
    <div v-else class="tlb-gal__empty">
      <Icon name="gallery" />
      <p>画廊空空如也。</p>
    </div>
  </div>
</template>

<style scoped>
.tlb-gal {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 0;
  min-height: 0;
}

/* ---- 工具栏 ---- */
.tlb-gal__toolbar {
  flex: none;
}

.tlb-gal__toolbar-row {
  gap: 6px;
}

/* 标签筛选输入:与 sm 按钮同高(26px),固定窄宽 */
.tlb-gal__find {
  flex: none;
  width: 195px;
  height: 26px;
  font-size: 12px;
}

/* 删除确认弹层定位锚 */
.tlb-gal__confirm-wrap {
  position: relative;
}

.tlb-gal__confirm {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 260px;
  max-width: calc(100vw - 40px);
  padding: 10px 12px;
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius-sm);
  background: var(--tlb-surface-opaque, var(--tlb-surface));
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.tlb-gal__confirm-text {
  font-size: 12px;
  color: var(--tlb-ink-soft);
}

.tlb-gal__confirm-text b {
  color: var(--tlb-danger);
}

.tlb-gal__confirm-btns {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

/* 对比数超限按钮转危险色提示 */
.tlb-gal__btn--warn {
  background: var(--tlb-danger);
  border-color: var(--tlb-danger);
  color: #fff;
}

/* ---- 批量标签弹层(工具栏顶部,向下展开) ---- */
.tlb-gal__tagwrap {
  position: relative;
}

.tlb-gal__tagscrim {
  position: fixed;
  inset: 0;
  z-index: 30;
}

.tlb-gal__tagpop {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 31;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 280px;
  max-width: calc(100vw - 40px);
  padding: 10px;
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius-sm);
  background: var(--tlb-surface-opaque, var(--tlb-surface));
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.tlb-gal__taginput {
  font-size: 12.5px;
}

.tlb-gal__taglist {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 180px;
  overflow-y: auto;
}

.tlb-gal__tagempty {
  font-size: 12px;
  color: var(--tlb-ink-muted);
}

.tlb-gal__taghint {
  font-size: 11px;
  color: var(--tlb-ink-muted);
  line-height: 1.5;
}

/* 部分选中项有该标签:accent 色虚框 */
.tlb-tagchip--partial {
  border-color: var(--tlb-accent);
  border-style: dashed;
  color: var(--tlb-accent);
  background: var(--tlb-surface-2);
}

/* ---- 网格 ---- */
.tlb-gal__grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
  align-content: start;
  padding-right: 4px;
}

.tlb-gal__cell {
  position: relative;
  border-radius: var(--tlb-radius-sm);
  overflow: hidden;
  border: 2px solid transparent;
  background: var(--tlb-surface-2);
  cursor: pointer;
  transition: border-color var(--tlb-dur) var(--tlb-ease), transform var(--tlb-dur) var(--tlb-ease);
}

/* 默认模式悬停抬起;选取模式不放大、只显高亮 */
.tlb-gal__grid:not(.is-picking) .tlb-gal__cell:hover {
  transform: translateY(-2px);
}

.is-picking .tlb-gal__cell {
  cursor: pointer;
}

.tlb-gal__cell--on {
  border-color: var(--tlb-accent);
  box-shadow: 0 0 0 1px var(--tlb-accent);
}

.tlb-gal__cell img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
}

.tlb-gal__ph {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 1;
  color: var(--tlb-ink-muted);
}

/* 选中角标:左上圆底对勾 */
.tlb-gal__pickbadge {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 2;
  width: 22px;
  height: 22px;
  border-radius: var(--tlb-radius-pill);
  background: var(--tlb-accent);
  color: var(--tlb-accent-ink);
  display: flex;
  align-items: center;
  justify-content: center;
}

.tlb-gal__cap {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--tlb-ink-soft);
  background: var(--tlb-surface);
}

.tlb-gal__tag {
  flex: none;
  max-width: 100%;
  padding: 0 5px;
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius-sm);
  background: var(--tlb-surface-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 超出前 3 个的标签默认隐藏,hover 图卡时全部展开 */
.tlb-gal__tag--extra {
  display: none;
}

.tlb-gal__cell:hover .tlb-gal__tag--extra {
  display: inline-block;
}

/* 默认模式:hover 右上删除 */
.tlb-gal__del {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--tlb-radius-pill);
  background: var(--tlb-overlay);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--tlb-dur) var(--tlb-ease);
}

.tlb-gal__cell:hover .tlb-gal__del {
  opacity: 1;
}

.tlb-gal__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--tlb-ink-muted);
  padding: 60px 0;
}

.tlb-gal__empty .tlb-icon {
  font-size: 32px;
  opacity: 0.6;
}

/* ---- 手機:標籤篩選獨佔第一行;批量管理/多圖對比/張數落第二行,清空全部收起 ---- */
.tlb-gal--mobile {
  gap: 8px;
  padding: 10px 0;
}

.tlb-gal--mobile .tlb-gal__find {
  order: -1;
  flex: 1 1 100%;
  width: auto;
}

.tlb-gal--mobile .tlb-gal__clearall {
  display: none;
}
</style>
