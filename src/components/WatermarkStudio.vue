<script setup lang="ts">
/**
 * 水印工坊弹窗:文字水印 Canvas 实时预览。
 * 平铺(斜向网格)或单个(九宫格);样式可命名保存(存 settings)。
 * 「套用并下载」对全部目标 id 逐张按原解析度渲染并触发下载。
 */
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';

import { history } from '@/state/historyList';
import { settings, newId } from '@/state/settings';
import type { TlbWatermarkConfig } from '@/types';
import { cachedImage, ui } from '@/state/ui';
import { notify } from '@/st/toast';
import Icon from '@/components/Icon.vue';
import TlbSelect from '@/components/TlbSelect.vue';

/* ---- 尺寸:实测浮动面板矩形(同 PreviewModal) ---- */

const MARGIN = 10;
const backdropEl = ref<HTMLElement | null>(null);
const stageEl = ref<HTMLElement | null>(null);
const box = ref({ x: MARGIN, y: MARGIN, w: 800, h: 600 });

let ro: ResizeObserver | null = null;

function measure(): void {
  const root = backdropEl.value?.getRootNode();
  const panel =
    root instanceof ShadowRoot ? (root.querySelector('.tlb-panel') as HTMLElement | null) : null;
  const r = panel?.getBoundingClientRect();
  if (r && r.width > 80 && r.height > 120) {
    const w = Math.min(960, r.width - MARGIN * 2);
    box.value = { x: r.left + (r.width - w) / 2, y: r.top + MARGIN, w, h: r.height - MARGIN * 2 };
  } else {
    box.value = {
      x: MARGIN,
      y: MARGIN,
      w: Math.min(960, window.innerWidth - MARGIN * 2),
      h: window.innerHeight - MARGIN * 2,
    };
  }
  void nextTick(redraw);
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
  ro?.disconnect();
  const root = backdropEl.value?.getRootNode();
  const panel =
    root instanceof ShadowRoot ? (root.querySelector('.tlb-panel') as HTMLElement | null) : null;
  ro = new ResizeObserver(queueMeasure);
  if (panel) ro.observe(panel);
  window.addEventListener('resize', queueMeasure);
  measure();
}

onMounted(() => {
  window.addEventListener('keydown', onKey, true);
  void nextTick(startObserving);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKey, true);
  ro?.disconnect();
});

const dialogStyle = computed(() => ({
  left: `${box.value.x}px`,
  top: `${box.value.y}px`,
  width: `${box.value.w}px`,
  height: `${box.value.h}px`,
}));

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation();
    close();
  }
}

function close(): void {
  ui.watermarkStudio.open = false;
}

/* ══════════════ 配置 ══════════════ */

const cfg = reactive<TlbWatermarkConfig>({
  text: '@yourname',
  fontPct: 4,
  color: '#ffffff',
  opacity: 0.25,
  rotation: -25,
  mode: 'tile',
  gapMul: 2.2,
  position: 9,
  marginPct: 3,
  stickerDataUrl: '',
  stickerSizePct: 12,
});

const targets = computed(() => ui.watermarkStudio.ids);
const previewIdx = ref(0);
const previewId = computed(() => targets.value[previewIdx.value] ?? null);

const previewImg = ref<HTMLImageElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);

function stepPreview(delta: number): void {
  const n = targets.value.length;
  if (n < 2) return;
  previewIdx.value = (previewIdx.value + delta + n) % n;
}

watch(
  previewId,
  async id => {
    previewImg.value = null;
    if (!id) return;
    try {
      const img = await cachedImage(id);
      if (previewId.value === id) previewImg.value = img;
      void nextTick(redraw);
    } catch {
      notify('error', '图片读取失败');
    }
  },
  { immediate: true },
);

/* ══════════════ 貼紙 ══════════════ */

const fileInputEl = ref<HTMLInputElement | null>(null);
const stickerImg = ref<HTMLImageElement | null>(null);
let stickerReady: Promise<void> = Promise.resolve();

/** data URL → 已解码图片(模块级缓存,同贴纸跨目标复用)。 */
const stickerCache = new Map<string, Promise<HTMLImageElement>>();
function loadSticker(dataUrl: string): Promise<HTMLImageElement> {
  const hit = stickerCache.get(dataUrl);
  if (hit) return hit;
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('贴纸读取失败'));
    img.src = dataUrl;
  });
  stickerCache.set(dataUrl, p);
  p.catch(() => stickerCache.delete(dataUrl));
  return p;
}

watch(
  () => cfg.stickerDataUrl,
  dataUrl => {
    stickerImg.value = null;
    if (!dataUrl) {
      stickerReady = Promise.resolve();
      return;
    }
    stickerReady = loadSticker(dataUrl)
      .then(img => {
        if (cfg.stickerDataUrl === dataUrl) stickerImg.value = img;
        void nextTick(redraw);
      })
      .catch(() => notify('error', '贴纸读取失败'));
  },
  { immediate: true },
);

function pickSticker(): void {
  fileInputEl.value?.click();
}

function onStickerFile(e: Event): void {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    notify('warning', '贴纸需小于 2MB(建议用透明 PNG)');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    cfg.stickerDataUrl = String(reader.result);
    cfg.mode = 'sticker';
  };
  reader.readAsDataURL(file);
  (e.target as HTMLInputElement).value = '';
}

function clearSticker(): void {
  cfg.stickerDataUrl = '';
}

/* ══════════════ 绘制(预览/输出共用,纯相对值) ══════════════ */

/** 九宫格锚点坐标(含边距)。 */
function anchorOf(c: TlbWatermarkConfig, w: number, h: number): { x: number; y: number } {
  const base = Math.min(w, h);
  const m = (base * c.marginPct) / 100;
  const col = ((c.position - 1) % 3) + 1;
  const row = Math.ceil(c.position / 3);
  return {
    x: col === 1 ? m : col === 2 ? w / 2 : w - m,
    y: row === 1 ? m : row === 2 ? h / 2 : h - m,
  };
}

function alignOf(position: number): CanvasTextAlign {
  const col = ((position - 1) % 3) + 1;
  return col === 1 ? 'left' : col === 2 ? 'center' : 'right';
}

function baselineOf(position: number): CanvasTextBaseline {
  const row = Math.ceil(position / 3);
  return row === 1 ? 'top' : row === 2 ? 'middle' : 'bottom';
}

/** 按九宫格位置贴图(x,y 为锚点)。 */
function drawAt(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dw: number,
  dh: number,
  x: number,
  y: number,
  position: number,
): void {
  const col = ((position - 1) % 3) + 1;
  const row = Math.ceil(position / 3);
  const dx = col === 1 ? x : col === 2 ? x - dw / 2 : x - dw;
  const dy = row === 1 ? y : row === 2 ? y - dh / 2 : y - dh;
  ctx.drawImage(img, dx, dy, dw, dh);
}

function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, c: TlbWatermarkConfig): void {
  ctx.save();

  if (c.mode === 'sticker') {
    const img = stickerImg.value;
    if (!img) {
      ctx.restore();
      return;
    }
    const base = Math.min(w, h);
    const targetW = (base * (c.stickerSizePct ?? 12)) / 100;
    const dw = targetW;
    const dh = (img.naturalHeight / img.naturalWidth) * targetW;
    const { x, y } = anchorOf(c, w, h);
    ctx.globalAlpha = c.opacity;
    drawAt(ctx, img, dw, dh, x, y, c.position);
    ctx.restore();
    return;
  }

  const text = c.text.trim();
  if (!text) {
    ctx.restore();
    return;
  }
  const base = Math.min(w, h);
  const fontPx = (base * c.fontPct) / 100;
  ctx.font = `600 ${fontPx}px -apple-system, "PingFang SC", "Segoe UI", Arial, sans-serif`;
  ctx.fillStyle = c.color;
  ctx.globalAlpha = c.opacity;

  if (c.mode === 'single') {
    const { x, y } = anchorOf(c, w, h);
    ctx.textAlign = alignOf(c.position);
    ctx.textBaseline = baselineOf(c.position);
    ctx.fillText(text, x, y);
  } else {
    const tw = ctx.measureText(text).width;
    const stepX = tw * c.gapMul;
    const stepY = fontPx * c.gapMul * 1.6;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(w / 2, h / 2);
    ctx.rotate((c.rotation * Math.PI) / 180);
    const span = Math.hypot(w, h);
    let row = 0;
    for (let y = -span; y <= span; y += stepY, row += 1) {
      const off = row % 2 ? stepX / 2 : 0;
      for (let x = -span; x <= span; x += stepX) ctx.fillText(text, x + off, y);
    }
  }
  ctx.restore();
}

/** 渲染到给定画布;imgW/imgH 为目标解析度(预览时=canvas 尺寸)。 */
function renderOn(canvas: HTMLCanvasElement, img: HTMLImageElement, w: number, h: number): void {
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  drawWatermark(ctx, canvas.width, canvas.height, cfg);
}

function redraw(): void {
  const canvas = canvasEl.value;
  const img = previewImg.value;
  const host = stageEl.value;
  if (!canvas || !img || !host) return;
  const hostW = host.clientWidth;
  const hostH = host.clientHeight;
  if (hostW < 10 || hostH < 10) return;
  const scale = Math.min(hostW / img.naturalWidth, hostH / img.naturalHeight);
  renderOn(canvas, img, img.naturalWidth * scale, img.naturalHeight * scale);
}

watch(cfg, () => void nextTick(redraw), { deep: true });

/* ══════════════ 套用并下载 ══════════════ */

const busy = ref(false);

function extOf(mime: string): string {
  return (mime.split('/')[1] || 'png').replace('jpeg', 'jpg');
}

async function applyAndDownload(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  await stickerReady;
  let done = 0;
  for (const id of targets.value) {
    const meta = history.items.find(i => i.id === id);
    let img: HTMLImageElement;
    try {
      img = await cachedImage(id);
    } catch {
      notify('error', `图片 ${id.slice(0, 8)} 读取失败,已跳过`);
      continue;
    }
    if (!meta) continue;
    const canvas = document.createElement('canvas');
    renderOn(canvas, img, img.naturalWidth, img.naturalHeight);
    await new Promise<void>(resolve => {
      canvas.toBlob(
        blob => {
          if (blob) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `taglab_wm_s${meta.seed}.${extOf(meta.mime)}`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
            done += 1;
          }
          resolve();
        },
        meta.mime === 'image/jpeg' ? 'image/jpeg' : 'image/png',
        0.92,
      );
    });
    await new Promise(r => setTimeout(r, 400));
  }
  busy.value = false;
  notify('success', done ? `已开始下载 ${done} 张水印图` : '没有可下载的图片');
}

/* ══════════════ 样式保存 ══════════════ */

const presetSel = ref('');

function applyPreset(): void {
  const p = settings.watermarkPresets.find(x => x.id === presetSel.value);
  if (!p) return;
  Object.assign(cfg, p.config);
}

/** 💾 寫回目前樣式。 */
function savePreset(): void {
  const p = settings.watermarkPresets.find(x => x.id === presetSel.value);
  if (!p) {
    notify('warning', '先選擇一個水印樣式');
    return;
  }
  p.config = { ...cfg };
  notify('success', `樣式「${p.name}」已保存`);
}

/** ＋ 目前配置另存為新樣式。 */
function savePresetAs(): void {
  const cur = settings.watermarkPresets.find(x => x.id === presetSel.value);
  const input = window.prompt('另存為新水印樣式,輸入名稱:', cur ? `${cur.name} 副本` : '新水印');
  if (input === null) return;
  const name = input.trim();
  if (!name) {
    notify('warning', '名稱不能為空');
    return;
  }
  const p = { id: newId('wm'), name, config: { ...cfg } };
  settings.watermarkPresets.push(p);
  presetSel.value = p.id;
  notify('success', `已另存為「${name}」`);
}

/** ✏️ 改名。 */
function renamePreset(): void {
  const p = settings.watermarkPresets.find(x => x.id === presetSel.value);
  if (!p) return;
  const input = window.prompt('重新命名水印樣式:', p.name);
  if (input === null) return;
  const name = input.trim();
  if (!name) {
    notify('warning', '名稱不能為空');
    return;
  }
  p.name = name;
  notify('success', `已改名為「${name}」`);
}

/** 🗑 刪除。 */
function deletePreset(): void {
  const p = settings.watermarkPresets.find(x => x.id === presetSel.value);
  if (!p) return;
  if (!window.confirm(`刪除水印樣式「${p.name}」?`)) return;
  const idx = settings.watermarkPresets.indexOf(p);
  settings.watermarkPresets.splice(idx, 1);
  presetSel.value = '';
}
</script>

<template>
  <div ref="backdropEl" class="tlb-wm-backdrop" @click.self="close">
    <div class="tlb-wm" role="dialog" aria-modal="true" aria-label="水印工坊" :style="dialogStyle">
      <!-- 左:预览舞台 -->
      <div ref="stageEl" class="tlb-wm__stage">
        <button class="tlb-wm__close" title="关闭" @click="close"><Icon name="close" /></button>
        <canvas ref="canvasEl" class="tlb-wm__canvas" />
        <div v-if="!previewImg" class="tlb-wm__loading"><Icon name="loader" spin /></div>
      </div>
      <template v-if="targets.length > 1">
        <button class="tlb-wm__nav tlb-wm__nav--l" @click="stepPreview(-1)"><Icon name="chevron-left" /></button>
        <button class="tlb-wm__nav tlb-wm__nav--r" @click="stepPreview(1)"><Icon name="chevron-right" /></button>
      </template>

      <!-- 右:控制区 -->
      <aside class="tlb-wm__controls tlb-scroll">
        <!-- 模式 -->
        <div class="tlb-seg">
          <button :class="{ 'is-on': cfg.mode === 'tile' }" @click="cfg.mode = 'tile'">平鋪</button>
          <button :class="{ 'is-on': cfg.mode === 'single' }" @click="cfg.mode = 'single'">單個</button>
          <button :class="{ 'is-on': cfg.mode === 'sticker' }" @click="cfg.mode = 'sticker'">貼紙</button>
        </div>

        <!-- 樣式組:與畫師串預設同款(下拉 + ＋/💾/✏️/🗑) -->
        <div>
          <label class="tlb-label">水印樣式</label>
          <div class="tlb-row tlb-wm__preset-row">
            <TlbSelect
              v-model="presetSel"
              class="tlb-wm__preset-sel"
              :options="[{ value: '', label: '(不使用)' }, ...settings.watermarkPresets.map(p => ({ value: p.id, label: p.name }))]"
              @change="applyPreset"
            />
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon" title="目前配置另存為新樣式" @click="savePresetAs"><Icon name="plus" /></button>
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon" title="保存到目前樣式" :disabled="!presetSel" @click="savePreset"><Icon name="save" /></button>
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon" title="重新命名目前樣式" :disabled="!presetSel" @click="renamePreset"><Icon name="rename" /></button>
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm tlb-btn--icon" title="刪除目前樣式" :disabled="!presetSel" @click="deletePreset"><Icon name="trash" /></button>
          </div>
        </div>

        <!-- 貼紙:上傳與參數 -->
        <template v-if="cfg.mode === 'sticker'">
          <input ref="fileInputEl" type="file" accept="image/png,image/*" hidden @change="onStickerFile" />
          <button v-if="!cfg.stickerDataUrl" class="tlb-wm__upload" @click="pickSticker">
            <Icon name="plus" /> 上傳貼紙(透明 PNG 為佳)
          </button>
          <div v-else class="tlb-wm__stickerbar">
            <img :src="cfg.stickerDataUrl" class="tlb-wm__stickerthumb" alt="貼紙預覽" />
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" @click="pickSticker">更換</button>
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" @click="clearSticker">移除</button>
          </div>

          <label class="tlb-field">
            <span>大小 {{ cfg.stickerSizePct }}%</span>
            <input v-model.number="cfg.stickerSizePct" type="range" min="2" max="50" step="1" />
          </label>
          <label class="tlb-field">
            <span>透明度 {{ cfg.opacity }}</span>
            <input v-model.number="cfg.opacity" type="range" min="0.05" max="1" step="0.05" />
          </label>
        </template>

        <!-- 文字參數(平鋪/單個) -->
        <template v-else>
          <label class="tlb-field">
            <span>水印文字</span>
            <input v-model="cfg.text" class="tlb-input" />
          </label>

          <label class="tlb-field">
            <span>字級 {{ cfg.fontPct }}%</span>
            <input v-model.number="cfg.fontPct" type="range" min="1" max="15" step="0.5" />
          </label>

          <label class="tlb-field">
            <span>透明度 {{ cfg.opacity }}</span>
            <input v-model.number="cfg.opacity" type="range" min="0.05" max="1" step="0.05" />
          </label>

          <div class="tlb-field tlb-field--row">
            <span>顏色</span>
            <input v-model="cfg.color" type="color" class="tlb-wm__color" />
          </div>
        </template>

        <!-- 平鋪專屬 -->
        <template v-if="cfg.mode === 'tile'">
          <label class="tlb-field">
            <span>旋轉 {{ cfg.rotation }}°</span>
            <input v-model.number="cfg.rotation" type="range" min="-90" max="0" step="1" />
          </label>
          <label class="tlb-field">
            <span>間距 {{ cfg.gapMul.toFixed(1) }}</span>
            <input v-model.number="cfg.gapMul" type="range" min="1.2" max="5" step="0.1" />
          </label>
        </template>

        <!-- 單個/貼紙共用:九宮格與邊距 -->
        <template v-if="cfg.mode === 'single' || cfg.mode === 'sticker'">
          <div class="tlb-field">
            <span>位置</span>
            <div class="tlb-wm__posgrid">
              <button
                v-for="n in 9"
                :key="n"
                class="tlb-wm__pos"
                :class="{ 'is-on': cfg.position === n }"
                @click="cfg.position = n"
              />
            </div>
          </div>
          <label class="tlb-field">
            <span>邊距 {{ cfg.marginPct }}%</span>
            <input v-model.number="cfg.marginPct" type="range" min="0" max="10" step="0.5" />
          </label>
        </template>

        <span class="tlb-grow" />

        <button class="tlb-btn tlb-btn--accent" :disabled="busy || !targets.length" @click="applyAndDownload">
          <Icon name="download" />
          {{ busy ? '处理中…' : `套用並下載${targets.length > 1 ? ` (${targets.length} 張)` : ''}` }}
        </button>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.tlb-wm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10030;
  background: transparent;
  pointer-events: auto;
}

.tlb-wm {
  position: absolute;
  display: flex;
  background: var(--tlb-surface-opaque, var(--tlb-surface));
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius);
  overflow: hidden;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
}

.tlb-wm__close {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 6;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: var(--tlb-radius-pill);
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tlb-wm__close:hover {
  background: rgba(0, 0, 0, 0.72);
}

/* ---- 舞台 ---- */
.tlb-wm__stage {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--tlb-surface-2-opaque, var(--tlb-surface-2));
}

.tlb-wm__canvas {
  flex: none;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.tlb-wm__loading {
  position: absolute;
  color: var(--tlb-ink-muted);
  font-size: 28px;
}

.tlb-wm__nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 4;
  width: 30px;
  height: 30px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: var(--tlb-radius-pill);
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tlb-wm__nav:hover {
  background: rgba(0, 0, 0, 0.72);
}

.tlb-wm__nav--l {
  left: 12px;
}

.tlb-wm__nav--r {
  left: calc(100% - 248px - 42px);
}

/* ---- 控制区 ---- */
.tlb-wm__controls {
  flex: none;
  width: 248px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-left: 1px solid var(--tlb-line);
}

.tlb-seg {
  display: flex;
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius-sm);
  overflow: hidden;
}

.tlb-seg button {
  flex: 1;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--tlb-ink-soft);
  font-size: 12.5px;
  cursor: pointer;
}

.tlb-seg button.is-on {
  background: var(--tlb-accent);
  color: var(--tlb-accent-ink);
}

.tlb-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--tlb-ink-soft);
}

.tlb-field--row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.tlb-field input[type='range'] {
  width: 100%;
  accent-color: var(--tlb-accent);
}

.tlb-wm__color {
  width: 42px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius-sm);
  background: transparent;
  cursor: pointer;
}

.tlb-wm__posgrid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 5px;
}

.tlb-wm__pos {
  aspect-ratio: 1;
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius-sm);
  background: var(--tlb-surface-2);
  cursor: pointer;
}

.tlb-wm__pos.is-on {
  border-color: var(--tlb-accent);
  background: color-mix(in srgb, var(--tlb-accent) 25%, transparent);
}

/* 上傳貼紙 */
.tlb-wm__upload {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 44px;
  border: 1px dashed var(--tlb-line);
  border-radius: var(--tlb-radius-sm);
  background: transparent;
  color: var(--tlb-ink-soft);
  font-size: 12.5px;
  cursor: pointer;
}

.tlb-wm__upload:hover {
  border-color: var(--tlb-accent);
  color: var(--tlb-ink);
}

.tlb-wm__stickerbar {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tlb-wm__stickerthumb {
  flex: none;
  width: 36px;
  height: 36px;
  object-fit: contain;
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius-sm);
  background:
    repeating-conic-gradient(var(--tlb-surface-2) 0% 25%, transparent 0% 50%) 50% / 12px 12px;
}

/* 樣式組:規格與畫師串預設行同款(gap 5、26px) */
.tlb-wm__preset-row {
  gap: 5px;
}

.tlb-wm__preset-row .tlb-btn--icon {
  width: 26px;
  height: 26px;
}

.tlb-wm__preset-sel {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  height: 26px;
}
</style>
