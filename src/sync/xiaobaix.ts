/**
 * 从小白X(LittleWhiteBox · NovelDraw)同步:画师串 + 负向词 + 预览图 + vibe + 组(单向只读)。
 *
 * 小白X 的设置不在 extension_settings,而在酒馆服务器文件
 * `/user/files/LittleWhiteBox_NovelDraw.json`,根对象 { settings: <配置> }。这里只 GET 读,绝不写。
 *
 * 映射:
 * - settings.paramsPresets[] { name, thumbnail(dataURL), positivePrefix, negativePrefix, vibe, params }
 *   · positivePrefix → 画师串 prompt(拼在场景前,与画师串同位);
 *   · 小白X 没有独立「正面质量词」字段(质量词靠 params.qualityToggle 的官方词)→ quality 留空;
 *   · negativePrefix → negative **原样搬**。该来源默认 ucPreset=0,负面 caption 就是 negativePrefix
 *     本身、不含官方基线,故这里不烤基线,烤了反而多出一堆词;
 *   · thumbnail 是内联 dataURL,直接作画板预览图。
 * - settings.vibeLibrary.singles[] { id,name,image,thumbnail,infoExtracted,encodings:{key: 裸base64} }
 *   encodings 的值是裸字符串,包成 { encoding, infoExtracted }。
 * - settings.vibeLibrary.groups[] { id,name,members:[{id,enabled,strength}] }(与画板组同构)。
 */
import { settings } from '@/state/settings';
import {
  applySyncPayload,
  ensureDataUrl,
  str,
  stripDataUrlPrefix,
  type IncomingArtist,
  type IncomingGroup,
  type IncomingVibe,
  type SyncPayload,
  type SyncReport,
} from '@/sync/shared';
import type { TlbVibeEncodings } from '@/types';

const FILE_URL = '/user/files/LittleWhiteBox_NovelDraw.json';
const FETCH_TIMEOUT_MS = 20_000;
/** 小白X vibe 只编码这四个模型 key;其余忽略。 */
const VIBE_KEYS = new Set(['v4curated', 'v4full', 'v4-5curated', 'v4-5full']);

export class XiaobaiSyncError extends Error {}

interface RawShape {
  settings?: unknown;
}

async function fetchSettingsFile(): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(FILE_URL, { signal: controller.signal, cache: 'no-cache' });
    if (resp.status === 404) {
      throw new XiaobaiSyncError('小白X 还没有在本酒馆保存过 NovelDraw 配置文件(至少先用它出一次图)');
    }
    if (!resp.ok) throw new XiaobaiSyncError(`读取小白X 配置失败(HTTP ${resp.status})`);
    const root = (await resp.json()) as RawShape;
    if (!root || typeof root !== 'object' || !root.settings || typeof root.settings !== 'object') {
      throw new XiaobaiSyncError('小白X 配置文件格式异常(缺少 settings 段)');
    }
    return root.settings as Record<string, unknown>;
  } catch (e) {
    if (e instanceof XiaobaiSyncError) throw e;
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new XiaobaiSyncError('读取小白X 配置超时');
    }
    throw new XiaobaiSyncError('读取小白X 配置失败:配置文件可能不是有效 JSON');
  } finally {
    clearTimeout(timer);
  }
}

/* ───────────────────────── 解析(对外部 JSON 全部宽松取值) ───────────────────────── */

function parseArtists(s: Record<string, unknown>): IncomingArtist[] {
  const presets = Array.isArray(s.paramsPresets) ? s.paramsPresets : [];
  const out: IncomingArtist[] = [];
  for (const item of presets) {
    const p = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
    if (!p) continue;
    const name = str(p.name).trim();
    if (!name) continue;
    out.push({
      name,
      prompt: str(p.positivePrefix).trim(),
      quality: '',
      negative: str(p.negativePrefix).trim(),
      preview: str(p.thumbnail).trim(),
    });
  }
  return out;
}

function parseVibes(s: Record<string, unknown>): IncomingVibe[] {
  const lib = s.vibeLibrary && typeof s.vibeLibrary === 'object'
    ? (s.vibeLibrary as Record<string, unknown>)
    : null;
  const singles = lib && Array.isArray(lib.singles) ? lib.singles : [];
  const out: IncomingVibe[] = [];
  for (const item of singles) {
    const v = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
    if (!v) continue;
    const id = str(v.id);
    const rawEnc = v.encodings && typeof v.encodings === 'object'
      ? (v.encodings as Record<string, unknown>)
      : {};
    const infoExtracted = Number(v.infoExtracted) === 0 ? 0 : 1;
    const encodings: TlbVibeEncodings = {};
    for (const [key, val] of Object.entries(rawEnc)) {
      if (VIBE_KEYS.has(key) && typeof val === 'string' && val) {
        encodings[key] = { encoding: val, infoExtracted };
      }
    }
    const image = stripDataUrlPrefix(v.image);
    const thumbnail = ensureDataUrl(v.thumbnail || v.image);
    // 有效条目判定:图和编码至少有一个
    if (!image && !Object.keys(encodings).length) continue;
    out.push({
      sourceId: id,
      name: str(v.name).slice(0, 60) || '导入的 Vibe',
      image,
      thumbnail,
      encodings,
      strength: 0.6, // single 不挂强度;强度跟随组/选择
    });
  }
  return out;
}

function parseGroups(s: Record<string, unknown>): IncomingGroup[] {
  const lib = s.vibeLibrary && typeof s.vibeLibrary === 'object'
    ? (s.vibeLibrary as Record<string, unknown>)
    : null;
  const groups = lib && Array.isArray(lib.groups) ? lib.groups : [];
  const out: IncomingGroup[] = [];
  for (const item of groups) {
    const g = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
    if (!g || !Array.isArray(g.members)) continue;
    const name = str(g.name).trim();
    if (!name) continue;
    const seen = new Set<string>();
    const members = g.members
      .map((m): { sourceVibeId: string; enabled: boolean; strength: number } | null => {
        const mem = m && typeof m === 'object' ? (m as Record<string, unknown>) : null;
        const sourceVibeId = mem ? str(mem.id) : '';
        if (!sourceVibeId || seen.has(sourceVibeId)) return null;
        seen.add(sourceVibeId);
        const strength = Number(mem?.strength);
        return {
          sourceVibeId,
          enabled: mem?.enabled !== false,
          strength: Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0.6,
        };
      })
      .filter((m): m is { sourceVibeId: string; enabled: boolean; strength: number } => m !== null);
    if (members.length) out.push({ name, members });
  }
  return out;
}

export interface XiaobaiSyncOptions {
  onProgress?: (stage: string, current: number, total: number) => void;
}

/** 执行小白X 同步。 */
export async function syncFromXiaobai(options: XiaobaiSyncOptions = {}): Promise<SyncReport> {
  const s = await fetchSettingsFile();
  const payload: SyncPayload = {
    artists: parseArtists(s),
    vibes: parseVibes(s),
    groups: parseGroups(s),
  };
  options.onProgress?.('合并', 1, 1);
  if (!payload.artists.length && !payload.vibes.length) {
    throw new XiaobaiSyncError('小白X 配置里没有可同步的画师串或 vibe');
  }
  const report = await applySyncPayload(payload);
  settings.lastXiaobaiSyncAt = Date.now();
  return report;
}
