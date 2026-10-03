<template>
  <div class="gen-panel">
    <div class="gen-layout">
      <!-- 左列：画师串、正向词、快捷Tag、负面词 -->
      <div class="gen-col">
        <!-- 模块卡片 1：画师串预设 (单色紫浅色顶额) -->
        <div class="tlb-card-deck">
          <div class="deck-header">
            <div class="deck-title">
              <span>画师串预设</span>
              <span class="deck-meta">[ACTIVE]</span>
            </div>
            <span class="deck-meta">{{ artistPresets.length }} PRESETS</span>
          </div>
          <div class="deck-body">
            <div class="action-row">
              <select v-model="selectedPreset" class="tlb-select flex-1">
                <option v-for="preset in artistPresets" :key="preset.id" :value="preset.id">
                  {{ preset.name }}
                </option>
              </select>
              <button class="tlb-btn tlb-btn-icon" title="新建" @click="handleNewPreset">+</button>
              <button class="tlb-btn tlb-btn-icon" title="保存" @click="handleSavePreset">💾</button>
              <button class="tlb-btn tlb-btn-icon" title="重命名" @click="handleRenamePreset">✏️</button>
              <button class="tlb-btn tlb-btn-icon btn-danger" title="删除" @click="handleDeletePreset">🗑️</button>
            </div>

            <div class="label-row">
              <span class="label-title">画师串输入框</span>
              <span class="pixel-en label-meta">PREPEND</span>
            </div>
            <textarea
              v-model="artistPrompt"
              class="tlb-textarea pixel-en"
              rows="2"
              placeholder="输入画师串 Tags..."
            ></textarea>
          </div>
        </div>

        <!-- 模块卡片 2：正面提示词 (浅色卡带顶额 + 奶油色快捷输入) -->
        <div class="tlb-card-deck">
          <div class="deck-header">
            <div class="deck-title">
              <span>正面提示词</span>
              <span class="deck-meta">[PROMPT]</span>
            </div>
            <div class="deck-actions">
              <button class="deck-btn" @click="clearPrompt">清空</button>
              <button class="deck-btn" @click="copyPrompt">复制</button>
            </div>
          </div>
          <div class="deck-body">
            <textarea
              v-model="mainPrompt"
              class="tlb-textarea"
              rows="3"
              placeholder="或使用自然语言描述后点击AI，让提示词助手协助生成..."
            ></textarea>

            <!-- 快捷输入：纯单色莫兰迪奶油色系无边框平涂色块 -->
            <div class="quick-tag-container">
              <div class="quick-tag-bar">
                <button
                  v-for="tag in quickTags"
                  :key="tag"
                  class="flat-tag pixel-en"
                  :class="{ 'flat-tag-active': activeTags.includes(tag) }"
                  @click="toggleQuickTag(tag)"
                >
                  {{ tag }}
                </button>
              </div>
              <div class="btn-group-tight">
                <button class="tlb-btn tlb-btn-sm tlb-btn-purple" @click="$emit('ai-assist')">
                  <span>AI 辅助</span>
                </button>
                <button class="tlb-btn tlb-btn-sm tlb-btn-generate" @click="triggerGenerate">
                  <span>生成</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 负面提示词折叠栏 -->
        <div class="tlb-collapse">
          <div class="tlb-collapse-header" @click="toggleCollapse('negative')">
            <span>负面提示词 <span class="pixel-en opacity-70">(UNDESIRED)</span></span>
            <span class="collapse-arrow">{{ collapseState.negative ? '▾' : '▸' }}</span>
          </div>
          <div v-show="collapseState.negative" class="tlb-collapse-body">
            <textarea
              v-model="negativePrompt"
              class="tlb-textarea pixel-en text-xs"
              rows="2"
              placeholder="输入负面提示词..."
            ></textarea>
          </div>
        </div>
      </div>

      <!-- 右列：Vibe Transfer 与生图参数 -->
      <div class="gen-col">
        <!-- Vibe Transfer 卡片 -->
        <div class="tlb-card-deck">
          <div class="deck-header">
            <div class="deck-title">
              <span>Vibe 氛围转移</span>
              <span class="deck-meta">[V4/V4.5]</span>
            </div>
            <span class="deck-meta">TRANSFER</span>
          </div>
          <div class="deck-body">
            <div class="action-row">
              <select v-model="selectedVibeGroup" class="tlb-select flex-1">
                <option value="default">— Vibe 组 —</option>
                <option value="smoke-purple">薄暮烟紫组</option>
                <option value="thick-paint">厚涂光感组</option>
              </select>
              <button class="tlb-btn tlb-btn-icon" title="新建组">+</button>
              <button class="tlb-btn tlb-btn-icon" title="重命名">✏️</button>
              <button class="tlb-btn tlb-btn-icon" title="保存组">💾</button>
              <button class="tlb-btn tlb-btn-icon btn-danger" title="删除组">🗑️</button>
              <button class="tlb-btn tlb-btn-icon" title="导入">⬆️</button>
              <button class="tlb-btn tlb-btn-icon" title="导出">📋</button>
            </div>

            <!-- 虚线上传参考图框 (奶油色系，边框精准 1.5px) -->
            <div class="vibe-upload-zone" @click="triggerUpload">
              <div class="pixel-en font-bold">点击上传参考图</div>
              <div class="upload-subtext">编码耗费点数 · 仅 NAI V4 / V4.5 支持</div>
              <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileSelected" />
            </div>

            <!-- 已编码项目卡片 -->
            <div v-for="(item, idx) in vibeList" :key="idx" class="vibe-card-item">
              <img :src="item.thumb" class="vibe-thumb" :alt="item.name" />
              <div class="vibe-details">
                <div class="vibe-row-between">
                  <div class="flex-align-center gap-1">
                    <input v-model="item.enabled" type="checkbox" class="tlb-checkbox" />
                    <span class="pixel-en font-bold text-xs truncate max-w-180">{{ item.name }}</span>
                  </div>
                  <span class="pixel-en font-bold text-purple">{{ item.strength }}</span>
                </div>
                <div class="vibe-slider-row">
                  <span>强度</span>
                  <input
                    v-model.number="item.strength"
                    type="range"
                    class="vibe-slider"
                    min="0"
                    max="1"
                    step="0.05"
                  />
                </div>
                <div class="vibe-row-between mt-1">
                  <select v-model="item.mode" class="tlb-select vibe-mode-select">
                    <option value="comp">高·构图</option>
                    <option value="style">中·风格</option>
                    <option value="color">低·色彩</option>
                  </select>
                  <div class="flex-align-center gap-1">
                    <!-- OK txt 无底色状态提示 -->
                    <span class="pixel-en vibe-status-tag">✓ ENCODED</span>
                    <button class="tlb-btn tlb-btn-sm tlb-btn-icon btn-tight" title="导出">⬆️</button>
                    <button class="tlb-btn tlb-btn-sm tlb-btn-icon btn-tight btn-danger" title="移除" @click="removeVibe(idx)">✕</button>
                  </div>
                </div>
              </div>
            </div>

            <!-- 状态提示文字：无底色透明排版 -->
            <div class="status-tip-text">
              <span class="font-semibold">✓ 处理完成：已入库并勾选</span>
            </div>
          </div>
        </div>

        <!-- 生图参数折叠栏 -->
        <div class="tlb-collapse">
          <div class="tlb-collapse-header" @click="toggleCollapse('params')">
            <span>生图参数 <span class="pixel-en text-purple text-xs">{{ params.model }} · {{ params.resolution }}</span></span>
            <span class="collapse-arrow">{{ collapseState.params ? '▾' : '▸' }}</span>
          </div>
          <div v-show="collapseState.params" class="tlb-collapse-body">
            <div class="params-grid">
              <div>
                <div class="param-label">模型</div>
                <select v-model="params.model" class="tlb-select">
                  <option value="nai-diffusion-4-5-full">NAI 4.5 Full(无过滤)</option>
                  <option value="nai-diffusion-4-5-curated">NAI 4.5 Curated(有内容过滤)</option>
                  <option value="nai-diffusion-5-full">NAI 5 Full(最新)</option>
                  <option value="nai-diffusion-3">NAI 3</option>
                </select>
              </div>
              <div>
                <div class="param-label">分辨率</div>
                <select v-model="params.resolution" class="tlb-select pixel-en">
                  <option value="832×1216">832×1216 (PORTRAIT)</option>
                  <option value="1216×832">1216×832 (LANDSCAPE)</option>
                  <option value="1024×1024">1024×1024 (SQUARE)</option>
                </select>
              </div>
              <div>
                <div class="param-label">采样步数 (Steps)</div>
                <input v-model.number="params.steps" type="number" class="tlb-input pixel-en" />
              </div>
              <div>
                <div class="param-label">提示词相关性 (Scale)</div>
                <input v-model.number="params.scale" type="number" step="0.5" class="tlb-input pixel-en" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 生成结果单张轮播检视区 (每次只显示一张图片，左右有箭头) -->
    <div class="gen-viewer-card">
      <div class="deck-header">
        <div class="deck-title">
          <span>生成结果</span>
          <span class="deck-meta">[ {{ currentViewerIndex + 1 }} / {{ generatedImages.length || 1 }} ]</span>
        </div>
        <div class="deck-actions">
          <button class="deck-btn" @click="$emit('open-watermark', currentImage)">水印工坊</button>
        </div>
      </div>

      <div class="gen-viewer-stage">
        <!-- 左切换箭头 -->
        <button
          class="gen-viewer-arrow gen-viewer-arrow-left"
          title="上一张"
          :disabled="generatedImages.length <= 1"
          @click="prevImage"
        >
          ‹
        </button>

        <!-- 当前单张大图展示 -->
        <img
          v-if="currentImage"
          :src="currentImage.url"
          class="gen-viewer-img"
          alt="generated-result"
          title="点击进入水印工坊 / 大图预览"
          @click="$emit('open-watermark', currentImage)"
        />

        <!-- 右切换箭头 -->
        <button
          class="gen-viewer-arrow gen-viewer-arrow-right"
          title="下一张"
          :disabled="generatedImages.length <= 1"
          @click="nextImage"
        >
          ›
        </button>

        <!-- 悬浮胶囊标签：分辨率与 Seed -->
        <div v-if="currentImage" class="gen-viewer-badge pixel-en">
          <span>{{ currentImage.resolution }} · seed {{ currentImage.seed }}</span>
        </div>
      </div>
    </div>

    <!-- 还没有更多图片占位区 (奶油色系，精准 1.5px 虚线边框) -->
    <div class="gallery-empty-placeholder">
      <span>还没有更多图片。快点写提示词去生成吧！</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

export interface GeneratedImageItem {
  id: string | number;
  url: string;
  resolution: string;
  seed: string;
  timestamp?: number;
}

export interface VibeItem {
  name: string;
  thumb: string;
  strength: number;
  mode: string;
  enabled: boolean;
}

const emit = defineEmits<{
  (e: 'generate', payload: any): void;
  (e: 'ai-assist'): void;
  (e: 'open-watermark', image: GeneratedImageItem): void;
}>();

// 画师串预设
const artistPresets = ref([
  { id: '1', name: '華麗' },
  { id: '2', name: '韩漫' },
  { id: '3', name: '0.5山石' },
  { id: '4', name: 'Alice' },
  { id: '5', name: 'CG' },
  { id: '6', name: 'Chibi' },
  { id: '7', name: 'FR-vibe base' },
  { id: '8', name: 'Shanghai_花子' },
]);
const selectedPreset = ref('1');
const artistPrompt = ref('4::masterpiece, best quality ::, 2::year2024, year2025 ::, 2::pale skin only::, 2::artist flamma (immortalemignis)::, 2.5d, cg, 0.8::artist rei (sanbonzakura):: 1.8::artist');

// 正面提示词 & 快捷 Tag
const mainPrompt = ref('');
const quickTags = ref(['1girl', 'masterpiece', '前置', '1boy', 'solo', 'cowboy shot']);
const activeTags = ref<string[]>(['前置']);

// 负面提示词
const negativePrompt = ref('lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page');

// 折叠状态
const collapseState = ref({
  negative: false,
  params: false,
});

// Vibe Transfer
const selectedVibeGroup = ref('default');
const vibeList = ref<VibeItem[]>([
  {
    name: 'taglab_wm_s2533694370',
    thumb: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=150&auto=format&fit=crop&q=60',
    strength: 0.6,
    mode: 'comp',
    enabled: true,
  },
]);

// 生图参数
const params = ref({
  model: 'nai-diffusion-4-5-full',
  resolution: '832×1216',
  steps: 23,
  scale: 5.0,
});

// 生成结果轮播图片列表（每次只显示一张）
const generatedImages = ref<GeneratedImageItem[]>([
  {
    id: 1,
    url: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=1000&auto=format&fit=crop&q=80',
    resolution: '832×1216',
    seed: '3502419603',
  },
  {
    id: 2,
    url: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=1000&auto=format&fit=crop&q=80',
    resolution: '832×1216',
    seed: '1829401724',
  },
  {
    id: 3,
    url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=1000&auto=format&fit=crop&q=80',
    resolution: '1216×832',
    seed: '901827419',
  },
]);
const currentViewerIndex = ref(0);

const currentImage = computed(() => {
  if (generatedImages.value.length === 0) return null;
  return generatedImages.value[currentViewerIndex.value];
});

function prevImage() {
  if (generatedImages.value.length <= 1) return;
  currentViewerIndex.value =
    (currentViewerIndex.value - 1 + generatedImages.value.length) % generatedImages.value.length;
}

function nextImage() {
  if (generatedImages.value.length <= 1) return;
  currentViewerIndex.value = (currentViewerIndex.value + 1) % generatedImages.value.length;
}

function toggleCollapse(key: 'negative' | 'params') {
  collapseState.value[key] = !collapseState.value[key];
}

function toggleQuickTag(tag: string) {
  const idx = activeTags.value.indexOf(tag);
  if (idx >= 0) {
    activeTags.value.splice(idx, 1);
  } else {
    activeTags.value.push(tag);
    if (!mainPrompt.value.includes(tag)) {
      mainPrompt.value = mainPrompt.value ? `${mainPrompt.value}, ${tag}` : tag;
    }
  }
}

function clearPrompt() {
  mainPrompt.value = '';
}

function copyPrompt() {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(mainPrompt.value);
  }
}

function triggerGenerate() {
  emit('generate', {
    artistPrompt: artistPrompt.value,
    mainPrompt: mainPrompt.value,
    negativePrompt: negativePrompt.value,
    params: { ...params.value },
    vibes: vibeList.value.filter((v) => v.enabled),
  });
}

const fileInput = ref<HTMLInputElement | null>(null);
function triggerUpload() {
  fileInput.value?.click();
}

function onFileSelected(e: Event) {
  const target = e.target as HTMLInputElement;
  if (target.files && target.files[0]) {
    const file = target.files[0];
    const url = URL.createObjectURL(file);
    vibeList.value.push({
      name: file.name.replace(/\.[^/.]+$/, ''),
      thumb: url,
      strength: 0.6,
      mode: 'comp',
      enabled: true,
    });
  }
}

function removeVibe(idx: number) {
  vibeList.value.splice(idx, 1);
}

function handleNewPreset() {
  const name = prompt('输入新预设名称:');
  if (name) {
    const id = String(Date.now());
    artistPresets.value.push({ id, name });
    selectedPreset.value = id;
  }
}

function handleSavePreset() {
  alert('预设已保存');
}

function handleRenamePreset() {
  const preset = artistPresets.value.find((p) => p.id === selectedPreset.value);
  if (preset) {
    const newName = prompt('输入新名称:', preset.name);
    if (newName) preset.name = newName;
  }
}

function handleDeletePreset() {
  if (artistPresets.value.length <= 1) return;
  const idx = artistPresets.value.findIndex((p) => p.id === selectedPreset.value);
  if (idx >= 0) {
    artistPresets.value.splice(idx, 1);
    selectedPreset.value = artistPresets.value[0].id;
  }
}
</script>

<style scoped>
/* 局部变量映射至全局设计令牌 */
.gen-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.gen-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

@media (max-width: 720px) {
  .gen-layout {
    grid-template-columns: 1fr;
  }
}

.gen-col {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 卡带式卡片 */
.tlb-card-deck {
  background: var(--tlb-surface, #FCFAF6);
  border: 1.5px solid var(--tlb-stroke, #615275);
  border-radius: var(--tlb-radius, 6px);
  box-shadow: var(--tlb-shadow-card, 2.5px 2.5px 0px #615275);
  overflow: hidden;
}

/* 统一浅色卡带顶额 */
.deck-header {
  height: 28px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  user-select: none;
  background: var(--tlb-purple-soft, #EDE8F3);
  color: var(--tlb-ink, #3D3349);
  border-bottom: 1.5px solid var(--tlb-stroke, #615275);
}

.deck-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  font-size: 12px;
}

.deck-meta {
  font-family: var(--tlb-font-pixel, 'Pixelify Sans', monospace);
  font-size: 11px;
  opacity: 0.85;
}

.deck-actions {
  display: flex;
  gap: 4px;
}

.deck-btn {
  height: 18px;
  padding: 0 6px;
  font-size: 10px;
  background: var(--tlb-surface, #FCFAF6);
  color: var(--tlb-ink, #3D3349);
  border: 1px solid var(--tlb-stroke, #615275);
  border-radius: 2px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: none;
}

.deck-btn:active {
  transform: translate(0.5px, 0.5px);
}

.deck-body {
  padding: 10px;
}

.action-row {
  display: flex;
  gap: 4px;
  align-items: center;
  margin-bottom: 8px;
}

.label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.label-title {
  font-size: 11.5px;
  font-weight: 700;
}

.label-meta {
  font-size: 11px;
  color: var(--tlb-ink-muted, #968B9F);
}

/* 文本域与输入控件 */
.tlb-textarea {
  width: 100%;
  border: 1.5px solid var(--tlb-stroke, #615275);
  border-radius: var(--tlb-radius-sm, 4px);
  padding: 6px 8px;
  font-size: 12.5px;
  background: var(--tlb-surface, #FCFAF6);
  color: var(--tlb-ink, #3D3349);
  outline: none;
  box-sizing: border-box;
  resize: vertical;
}

.tlb-textarea:focus {
  border-color: var(--tlb-purple, #7E6C94);
}

.tlb-select {
  height: 26px;
  border: 1.5px solid var(--tlb-stroke, #615275);
  border-radius: var(--tlb-radius-sm, 4px);
  padding: 0 8px;
  background: var(--tlb-surface, #FCFAF6);
  color: var(--tlb-ink, #3D3349);
  font-size: 11.5px;
  font-weight: 600;
  outline: none;
}

.tlb-input {
  height: 26px;
  border: 1.5px solid var(--tlb-stroke, #615275);
  border-radius: var(--tlb-radius-sm, 4px);
  padding: 0 6px;
  background: var(--tlb-surface, #FCFAF6);
  color: var(--tlb-ink, #3D3349);
  font-size: 11.5px;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}

.tlb-btn {
  height: 26px;
  padding: 0 10px;
  border: 1.5px solid var(--tlb-stroke, #615275);
  border-radius: var(--tlb-radius-sm, 4px);
  background: var(--tlb-surface, #FCFAF6);
  color: var(--tlb-ink, #3D3349);
  font-weight: 700;
  font-size: 12px;
  box-shadow: var(--tlb-shadow-btn, 2px 2px 0px #615275);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  user-select: none;
}

.tlb-btn:active {
  transform: translate(1px, 1px);
  box-shadow: 1px 1px 0px var(--tlb-stroke, #615275);
}

.tlb-btn-sm {
  height: 22px;
  padding: 0 8px;
  font-size: 11px;
}

.tlb-btn-icon {
  width: 26px;
  padding: 0;
}

.tlb-btn-purple {
  background: var(--tlb-purple, #7E6C94);
  color: #FFFFFF;
}

.tlb-btn-generate {
  background: var(--tlb-purple-deep, #5A4A70);
  color: #FFFFFF;
  font-size: 12px;
}

.btn-danger {
  color: var(--tlb-purple, #7E6C94);
}

.btn-tight {
  width: 22px;
  height: 22px;
}

/* 快捷输入：纯奶油色系无边框平涂色块 */
.quick-tag-container {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  gap: 8px;
}

.quick-tag-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.flat-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 25px;
  padding: 0 10px;
  background: var(--tlb-cream, #F5EFE6);
  color: var(--tlb-cream-ink, #3D3349);
  font-size: 11.5px;
  font-weight: 600;
  border-radius: var(--tlb-radius-sm, 4px);
  border: none;
  cursor: pointer;
  user-select: none;
  transition: background var(--tlb-dur, 0.12s);
}

.flat-tag:hover {
  background: var(--tlb-cream-hover, #EFE5D5);
}

.flat-tag-active {
  background: var(--tlb-cream-active, #E4D6C1) !important;
  font-weight: 700;
}

.btn-group-tight {
  display: flex;
  gap: 6px;
  flex: none;
}

/* 折叠栏样式 */
.tlb-collapse {
  border: 1.5px solid var(--tlb-stroke, #615275);
  border-radius: var(--tlb-radius, 6px);
  background: var(--tlb-surface, #FCFAF6);
  box-shadow: var(--tlb-shadow-card, 2.5px 2.5px 0px #615275);
  overflow: hidden;
}

.tlb-collapse-header {
  height: 28px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  background: var(--tlb-purple-soft, #EDE8F3);
  color: var(--tlb-ink, #3D3349);
  font-size: 11.5px;
  font-weight: 700;
  user-select: none;
  border-bottom: 1.5px solid var(--tlb-stroke, #615275);
}

.tlb-collapse-body {
  padding: 10px;
}

/* Vibe 虚线上传框：精准 1.5px 奶油色虚线 */
.vibe-upload-zone {
  border: 1.5px dashed var(--tlb-cream-stroke, #D2C4B4);
  border-radius: var(--tlb-radius-sm, 4px);
  background: var(--tlb-cream, #F5EFE6);
  padding: 14px 10px;
  text-align: center;
  color: var(--tlb-ink, #3D3349);
  cursor: pointer;
  transition: background var(--tlb-dur, 0.12s);
}

.vibe-upload-zone:hover {
  background: var(--tlb-cream-hover, #EFE5D5);
}

.upload-subtext {
  font-size: 10.5px;
  color: var(--tlb-ink-muted, #968B9F);
  margin-top: 3px;
}

/* 已编码项目卡片 */
.vibe-card-item {
  display: flex;
  gap: 8px;
  padding: 6px;
  border: 1.5px solid var(--tlb-stroke, #615275);
  border-radius: var(--tlb-radius-sm, 4px);
  background: var(--tlb-surface, #FCFAF6);
  margin-top: 8px;
}

.vibe-thumb {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border: 1px solid var(--tlb-stroke, #615275);
  border-radius: 2px;
}

.vibe-details {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-width: 0;
}

.vibe-row-between {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.vibe-slider-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
}

/* 滑动杆：轨道细线 4px，滑块为细长方形 */
.vibe-slider {
  -webkit-appearance: none;
  appearance: none;
  flex: 1;
  height: 4px;
  background: var(--tlb-surface, #FCFAF6);
  border: 1px solid var(--tlb-stroke, #615275);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
  margin: 4px 0;
}

.vibe-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 4px;
  height: 12px;
  background: var(--tlb-purple, #7E6C94);
  border: 1px solid var(--tlb-stroke, #615275);
  border-radius: 1px;
  cursor: ew-resize;
  box-shadow: 1px 1px 0px rgba(97, 82, 117, 0.35);
}

.vibe-slider::-moz-range-thumb {
  width: 4px;
  height: 12px;
  background: var(--tlb-purple, #7E6C94);
  border: 1px solid var(--tlb-stroke, #615275);
  border-radius: 1px;
  cursor: ew-resize;
  box-shadow: 1px 1px 0px rgba(97, 82, 117, 0.35);
}

.vibe-mode-select {
  height: 22px;
  padding: 0 16px 0 6px;
  font-size: 10px;
  width: 85px;
}

/* OK txt 彻底去除底色 */
.vibe-status-tag {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--tlb-purple-text, #4A3A60);
  background: transparent !important;
  padding: 0 2px;
}

.status-tip-text {
  margin-top: 6px;
  font-size: 11px;
  color: var(--tlb-ink-soft, #635872);
  display: flex;
  align-items: center;
  gap: 4px;
  background: transparent;
}

/* 参数网格 */
.params-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.param-label {
  font-size: 11px;
  font-weight: 700;
  margin-bottom: 2px;
}

/* ==================== 生成结果单张轮播检视区 ==================== */
.gen-viewer-card {
  background: var(--tlb-surface, #FCFAF6);
  border: 1.5px solid var(--tlb-stroke, #615275);
  border-radius: var(--tlb-radius, 6px);
  box-shadow: var(--tlb-shadow-card, 2.5px 2.5px 0px #615275);
  overflow: hidden;
  margin-top: 2px;
}

.gen-viewer-stage {
  position: relative;
  width: 100%;
  min-height: 480px;
  max-height: 600px;
  background: var(--tlb-surface-2, #EFE9E0);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.gen-viewer-img {
  max-width: 100%;
  max-height: 580px;
  width: auto;
  height: auto;
  object-fit: contain;
  display: block;
  cursor: pointer;
  user-select: none;
  transition: opacity var(--tlb-dur, 0.12s);
}

.gen-viewer-img:hover {
  opacity: 0.97;
}

/* 左右轮播大箭头 */
.gen-viewer-arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: rgba(45, 38, 55, 0.45);
  color: #FFFFFF;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  line-height: 1;
  backdrop-filter: blur(4px);
  transition: background var(--tlb-dur, 0.12s), transform var(--tlb-dur, 0.12s);
  z-index: 10;
  user-select: none;
}

.gen-viewer-arrow:hover:not(:disabled) {
  background: rgba(45, 38, 55, 0.75);
  transform: translateY(-50%) scale(1.08);
}

.gen-viewer-arrow:active:not(:disabled) {
  transform: translateY(-50%) scale(0.94);
}

.gen-viewer-arrow:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.gen-viewer-arrow-left {
  left: 16px;
}

.gen-viewer-arrow-right {
  right: 16px;
}

/* 检视区分辨率与 Seed 胶囊标签 */
.gen-viewer-badge {
  position: absolute;
  bottom: 14px;
  left: 16px;
  background: rgba(45, 38, 55, 0.55);
  color: #FFFFFF;
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 999px;
  font-family: var(--tlb-font-pixel, 'Pixelify Sans', monospace);
  letter-spacing: 0.3px;
  backdrop-filter: blur(4px);
  z-index: 10;
  user-select: none;
}

/* 还没有更多图片占位区：奶油色系 + 精准 1.5px 虚线 */
.gallery-empty-placeholder {
  border: 1.5px dashed var(--tlb-cream-stroke, #D2C4B4);
  border-radius: var(--tlb-radius, 6px);
  background: var(--tlb-cream, #F5EFE6);
  padding: 14px 10px;
  text-align: center;
  color: var(--tlb-ink-muted, #968B9F);
  font-size: 12px;
  font-weight: 600;
}

/* 实用工具类 */
.flex-1 { flex: 1; }
.hidden { display: none !important; }
.pixel-en { font-family: var(--tlb-font-pixel, 'Pixelify Sans', monospace); }
.font-bold { font-weight: 700; }
.font-semibold { font-weight: 600; }
.text-xs { font-size: 11px; }
.text-purple { color: var(--tlb-purple, #7E6C94); }
.opacity-70 { opacity: 0.7; }
.flex-align-center { display: flex; align-items: center; }
.gap-1 { gap: 4px; }
.mt-1 { margin-top: 4px; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.max-w-180 { max-width: 180px; }
</style>
