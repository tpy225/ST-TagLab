/**
 * 历史列表的会话内状态:元数据数组 + 当前选中 + 增删。
 * 图片 Blob 永不进内存缓存(Object URL 按需生成,见 state/ui.ts imageUrl)。
 */
import { reactive } from 'vue';

import { clearHistory, deleteHistory, listHistory, saveHistory } from '@/storage/history';
import type { TlbHistoryMeta } from '@/types';
import { makeThumbnail, revokeImageUrl, ui } from '@/state/ui';

export const history = reactive<{
  items: TlbHistoryMeta[];
  loaded: boolean;
  loading: boolean;
}>({
  items: [],
  loaded: false,
  loading: false,
});

export async function loadHistory(): Promise<void> {
  if (history.loading) return;
  history.loading = true;
  try {
    history.items = await listHistory();
    history.loaded = true;
    // 选中项悬空(删库/首次)→ 指向最新一张
    if (ui.currentId && !history.items.some(i => i.id === ui.currentId)) ui.currentId = null;
  } finally {
    history.loading = false;
  }
}

export async function addHistory(meta: TlbHistoryMeta, blob: Blob): Promise<void> {
  // 生成缩略图存入 meta,画廊网格读它而非全图(省内存/提速);失败留空,画廊回落读全图。
  meta.thumb = await makeThumbnail(blob);
  await saveHistory(meta, blob);
  history.items.unshift(meta);
  ui.currentId = meta.id;
}

export async function removeHistory(id: string): Promise<void> {
  await deleteHistory(id);
  const idx = history.items.findIndex(i => i.id === id);
  if (idx >= 0) history.items.splice(idx, 1);
  revokeImageUrl(id);
  if (ui.currentId === id) ui.currentId = history.items[0]?.id ?? null;
}

export async function wipeHistory(): Promise<void> {
  await clearHistory();
  for (const item of history.items) revokeImageUrl(item.id);
  history.items = [];
  ui.currentId = null;
}

/** 在列表里步进选中(delta ±1,环绕)。 */
export function stepSelection(delta: number): void {
  if (!history.items.length) return;
  const idx = history.items.findIndex(i => i.id === ui.currentId);
  const next = idx < 0 ? 0 : (idx + delta + history.items.length) % history.items.length;
  ui.currentId = history.items[next].id;
}

export function currentItem(): TlbHistoryMeta | null {
  return history.items.find(i => i.id === ui.currentId) ?? null;
}
