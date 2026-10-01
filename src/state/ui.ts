/**
 * UI 状态:面板开关、当前 tab、历史选择与图片 URL 缓存。
 * Object URL 按 id 缓存(会话级),删除历史时手动 revoke。
 */
import { reactive } from 'vue';

import { getBlob } from '@/storage/history';

export type TlbTab = 'gen' | 'compare' | 'gallery' | 'settings';

export const ui = reactive({
  panelOpen: false,
  tab: 'gen' as TlbTab,
  /** 当前查看的历史 id(画廊选中/生成页大图);null = 最新一张。 */
  currentId: null as string | null,
  /** 图片预览弹窗是否打开(画廊/大图点击共用)。 */
  previewOpen: false,
  /** 「回傳生成」等场景主动触发一次回填的信号(自增;GenPanel watch 它)。 */
  backfillNonce: 0,
  /** 画廊「多图对比」弹窗:打开时携带历史 id 列表(2–3 条)。 */
  galleryCompare: {
    open: false,
    ids: [] as string[],
  },
});

/** 正向提示词草稿(生成页正文;Bot「填 tag」跨页写入,故提为共享状态)。 */
export const promptDraft = reactive({ text: '' });

/**
 * 临时画师串内容(会话级,不落盘)。
 * 回填历史图时,若该图的画师串预设已不存在:下拉留空、内容填到这里,
 * 仍参与拼装(activeArtistPrompt 回落读它),便于原样复现;手动选预设即清空。
 */
export const artistDraft = reactive({ text: '' });

export function openPanel(tab?: TlbTab): void {
  if (tab) ui.tab = tab;
  ui.panelOpen = true;
}

export function closePanel(): void {
  ui.panelOpen = false;
}

export function togglePanel(): void {
  ui.panelOpen = !ui.panelOpen;
}

/* ---- Object URL 缓存 ---- */

const urlCache = new Map<string, string>();

export async function imageUrl(id: string): Promise<string | null> {
  const hit = urlCache.get(id);
  if (hit) return hit;
  const blob = await getBlob(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}

export function revokeImageUrl(id: string): void {
  const url = urlCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(id);
  }
}

/** 清空本会话全部图片 Object URL 缓存(设置页「清理缓存」)。 */
export function clearImageUrlCache(): number {
  const n = urlCache.size;
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
  return n;
}

/* ---- 缩略图 ---- */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片读取失败'));
    img.src = src;
  });
}

/**
 * 读本地图片文件并按最长边等比缩小,返回 dataURL。
 * 原图档:maxDim 1024 / image/jpeg / 0.9;缩略图:256 / 0.8(与小白X 同口径)。
 */
export async function downscaleFileToDataUrl(
  file: File,
  maxDim: number,
  mime = 'image/jpeg',
  quality = 0.9,
): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 不可用');
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL(mime, quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 从 Blob 或 dataURL/URL 生成小缩略图(最长边 256,jpeg);失败返回空串。 */
export async function makeThumbnail(src: Blob | string): Promise<string> {
  const isBlob = src instanceof Blob;
  const url = isBlob ? URL.createObjectURL(src) : src;
  try {
    return await new Promise<string>(resolve => {
      const img = new Image();
      img.onerror = () => resolve('');
      img.onload = () => {
        try {
          const max = 256;
          const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.max(1, Math.round(img.naturalWidth * scale));
          const h = Math.max(1, Math.round(img.naturalHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve('');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        } catch {
          resolve('');
        }
      };
      img.src = url;
    });
  } finally {
    if (isBlob) URL.revokeObjectURL(url);
  }
}
