/**
 * 画师库统一导出包(单个 / 批量同一文件格式)。
 *
 * 结构:
 * {
 *   identifier: 'taglab-artist-bundle', version, exportedAt,
 *   artists: [{ id,name,prompt,quality,negative,preview(dataURL) }],
 *   vibes:    [官方 .naiv4vibe 同构对象]
 * }
 *
 * 消费方(柏宝绘 / 智绘姬 / 小白X)按各自能力取字段 —— 画师串字段四家同形;
 * vibe 内层就是官方 novelai-vibe-transfer 结构,支持的插件直接走其 vibe 导入,
 * 不适配的插件 / 字段自动跳过,不影响画师串与正负词导入。
 */
import { VIBE_ENCODING_KEY } from '@/constants';
import { artistPreviews } from '@/state/artistPreviews';
import { settings } from '@/state/settings';
import { loadVibes, vibeList } from '@/state/vibeList';
import type { TlbVibe } from '@/types';

export const BUNDLE_IDENTIFIER = 'taglab-artist-bundle';
export const BUNDLE_VERSION = 1;

export interface BundleArtist {
  id: string;
  name: string;
  prompt: string;
  quality: string;
  negative: string;
  /** 预览图 dataURL(256 jpeg;空串 = 无预览图)。 */
  preview: string;
}

/** 官方 .naiv4vibe 同构(与 NovelAI / 三家插件的解析口径一致)。 */
export interface BundleVibe {
  identifier: 'novelai-vibe-transfer';
  name: string;
  /** 参考原图 base64(无 data: 前缀)。 */
  image: string;
  thumbnail: string;
  encodings: Record<
    string,
    Record<string, { encoding: string; params: { information_extracted: number } }>
  >;
  importInfo: { strength: number };
}

export interface ArtistBundle {
  identifier: typeof BUNDLE_IDENTIFIER;
  version: number;
  exportedAt: number;
  artists: BundleArtist[];
  vibes: BundleVibe[];
}

function toBundleVibe(v: TlbVibe): BundleVibe {
  const encodings: BundleVibe['encodings'] = {};
  for (const [modelKey, enc] of Object.entries(v.encodings)) {
    encodings[modelKey] = {
      [VIBE_ENCODING_KEY]: {
        encoding: enc.encoding,
        params: { information_extracted: enc.infoExtracted ?? v.infoExtracted ?? 1 },
      },
    };
  }
  return {
    identifier: 'novelai-vibe-transfer',
    name: v.name,
    image: v.image,
    thumbnail: v.thumbnail,
    encodings,
    importInfo: { strength: v.strength },
  };
}

/** 按给定画师 / vibe id 集合构建导出包(保持画师库当前顺序)。 */
export async function buildArtistBundle(presetIds: string[], vibeIds: string[]): Promise<ArtistBundle> {
  if (!vibeList.loaded) await loadVibes();
  const idSet = new Set(presetIds);
  const artists: BundleArtist[] = settings.artistPresets
    .filter(a => idSet.has(a.id))
    .map(a => ({
      id: a.id,
      name: a.name,
      prompt: a.prompt,
      quality: a.quality,
      negative: a.negative,
      preview: artistPreviews[a.id] ?? '',
    }));
  const vSet = new Set(vibeIds);
  const vibes = vibeList.items.filter(v => vSet.has(v.id)).map(toBundleVibe);
  return {
    identifier: BUNDLE_IDENTIFIER,
    version: BUNDLE_VERSION,
    exportedAt: Date.now(),
    artists,
    vibes,
  };
}

function safeFileName(name: string): string {
  return (name || 'artist').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
}

/** 触发浏览器下载(JSON)。 */
export function downloadBundle(bundle: ArtistBundle): void {
  const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const base =
    bundle.artists.length === 1
      ? `taglab_${safeFileName(bundle.artists[0].name)}`
      : `taglab_artists_${bundle.artists.length}`;
  a.href = url;
  a.download = `${base}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** 构建并下载;无画师时静默。 */
export async function exportArtists(presetIds: string[], vibeIds: string[] = []): Promise<void> {
  const bundle = await buildArtistBundle(presetIds, vibeIds);
  if (!bundle.artists.length) return;
  downloadBundle(bundle);
}
