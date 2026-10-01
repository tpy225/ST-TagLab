/**
 * 历史列表的会话内状态:元数据数组 + 当前选中 + 增删。
 * 图片 Blob 永不进内存缓存(Object URL 按需生成,见 state/ui.ts imageUrl)。
 */
import { computed, reactive, toRaw } from 'vue';

import { clearHistory, deleteHistory, listHistory, putMeta, saveHistory } from '@/storage/history';
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

/* ══════════════ 图片标签 ══════════════ */

/**
 * 落盘前剥掉 Vue reactive 包装:WebKit 对 Proxy 做结构化克隆会静默失败
 * (tags 数组同样要展开成纯数组)。
 */
async function persistMeta(it: TlbHistoryMeta): Promise<void> {
  const raw = toRaw(it);
  await putMeta({ ...raw, tags: raw.tags ? [...raw.tags] : undefined });
}

/** 解析输入:中英文逗号/回车分隔,去空白去重。 */
export function parseTags(input: string): string[] {
  const out: string[] = [];
  for (const raw of input.split(/[,，\n]/)) {
    const t = raw.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** 全部图片标签库(自动汇整,按使用频次排序)。 */
export const allImageTags = computed(() => {
  const count = new Map<string, number>();
  for (const it of history.items) for (const t of it.tags ?? []) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
});

/** 单张:增/删一个标签。 */
export async function setImageTag(id: string, tag: string, on: boolean): Promise<void> {
  const it = history.items.find(x => x.id === id);
  if (!it) return;
  const set = new Set(it.tags ?? []);
  if (on) set.add(tag);
  else set.delete(tag);
  it.tags = [...set];
  await persistMeta(it);
}

/** 单张:批量追加(输入框用)。 */
export async function addImageTags(id: string, tags: string[]): Promise<void> {
  const it = history.items.find(x => x.id === id);
  if (!it || !tags.length) return;
  it.tags = [...new Set([...(it.tags ?? []), ...tags])];
  await persistMeta(it);
}

/** 批量:所有选中项都有该 tag → 全部移除;否则全部加上。 */
export async function batchToggleTag(ids: string[], tag: string): Promise<void> {
  const items = history.items.filter(x => ids.includes(x.id));
  if (!items.length) return;
  const remove = items.every(x => (x.tags ?? []).includes(tag));
  for (const it of items) {
    const set = new Set(it.tags ?? []);
    if (remove) set.delete(tag);
    else set.add(tag);
    it.tags = [...set];
    await persistMeta(it);
  }
}

/** 批量:给选中项追加多个标签。 */
export async function batchAddTags(ids: string[], tags: string[]): Promise<void> {
  if (!tags.length) return;
  const items = history.items.filter(x => ids.includes(x.id));
  for (const it of items) {
    it.tags = [...new Set([...(it.tags ?? []), ...tags])];
    await persistMeta(it);
  }
}
