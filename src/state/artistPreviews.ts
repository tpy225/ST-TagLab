/**
 * 画师串预览图内存缓存:id → dataURL。启动全量加载一次(见 App.vue),同步/删除时增量维护。
 * 渲染方(多画师串对比)同步读这个 map,不必每张图异步取。
 */
import { reactive } from 'vue';

import { deleteArtistPreview, listArtistPreviews, saveArtistPreview } from '@/storage/previews';

export const artistPreviews = reactive<Record<string, string>>({});

let loaded = false;

export async function loadArtistPreviews(force = false): Promise<void> {
  if (loaded && !force) return;
  const all = await listArtistPreviews();
  for (const key of Object.keys(artistPreviews)) delete artistPreviews[key];
  Object.assign(artistPreviews, all);
  loaded = true;
}

/** 落盘并更新缓存。 */
export async function setArtistPreview(id: string, dataUrl: string): Promise<void> {
  if (!id || !dataUrl) return;
  await saveArtistPreview(id, dataUrl);
  artistPreviews[id] = dataUrl;
}

/** 删除预览图(删除画师串时调用)。 */
export async function removeArtistPreview(id: string): Promise<void> {
  await deleteArtistPreview(id);
  delete artistPreviews[id];
}
