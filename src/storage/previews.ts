/**
 * 画师串预览图存储:IndexedDB 'artist-preview' store。
 *
 * 为什么不放 localStorage:预览图即便压成 256px jpeg 也有几十 KB/张,几十上百条会撑爆
 * localStorage 配额。这里以画师串 id 为键存 dataURL 快照(从三家插件同步时复制一份,
 * 与对方文件生命周期解耦——对方删图不影响画板已同步的预览)。
 */
import { tx } from './history';

export interface ArtistPreviewRecord {
  /** = 画师串预设 id(TlbArtistPreset.id)。 */
  id: string;
  /** 256px jpeg dataURL。 */
  dataUrl: string;
}

export async function saveArtistPreview(id: string, dataUrl: string): Promise<void> {
  await tx('artist-preview', 'readwrite', s => s.put({ id, dataUrl } satisfies ArtistPreviewRecord));
}

export async function getArtistPreview(id: string): Promise<string> {
  const rec = await tx<ArtistPreviewRecord | undefined>('artist-preview', 'readonly', s => s.get(id));
  return rec?.dataUrl ?? '';
}

/** 全量预览图(启动加载进内存缓存,量级小)。 */
export async function listArtistPreviews(): Promise<Record<string, string>> {
  const all = await tx<ArtistPreviewRecord[]>('artist-preview', 'readonly', s => s.getAll());
  const out: Record<string, string> = {};
  for (const rec of all) out[rec.id] = rec.dataUrl;
  return out;
}

export async function deleteArtistPreview(id: string): Promise<void> {
  await tx('artist-preview', 'readwrite', s => s.delete(id));
}
