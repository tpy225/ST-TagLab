/**
 * Vibe 存储:完整正文(原图 base64 + 编码数据 + 缩略图)存 IndexedDB 'vibes' store。
 * 单一 record = 一条 TlbVibe,keyPath 'id'。列表页连正文一起读(量级小,手动测试够用)。
 */
import type { TlbVibe } from '@/types';

import { tx } from './history';

export async function saveVibe(vibe: TlbVibe): Promise<void> {
  await tx('vibes', 'readwrite', s => s.put(vibe));
}

/** vibe 列表(新→旧)。 */
export async function listVibes(): Promise<TlbVibe[]> {
  const all = await tx<TlbVibe[]>('vibes', 'readonly', s => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteVibe(id: string): Promise<void> {
  await tx('vibes', 'readwrite', s => s.delete(id));
}

/** 清空整个 vibe 库。 */
export async function clearVibes(): Promise<void> {
  await tx('vibes', 'readwrite', s => s.clear());
}