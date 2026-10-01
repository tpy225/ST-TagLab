/**
 * 历史图 → 当前编辑状态的全量回填(桌面生成页大图滑动、手机图区滑动、预览「回傳生成」共用)。
 *
 * 口径(与手机设计稿标注一致):
 * - 原始正向词填回 promptDraft(不含画师串/质量词,避免二次拼装);
 * - 画师串:预设还在 → 选中;预设已删/串已改 → **下拉留空、内容照填**(artistDraft,会话级,
 *   仍参与拼装,可原样复现);无画师串 → 不使用;
 * - 质量词/负面词/模型/采样器/步数/CFG/噪声表/尺寸/种子全部回到该图当时的值;
 * - vibe:按该图记录的 vibe id 列表勾选;已不存在的 id 不勾选,经返回值上报让 UI 提示。
 */
import { settings } from '@/state/settings';
import { artistDraft, promptDraft } from '@/state/ui';
import { updateVibe, vibeList } from '@/state/vibeList';
import type { TlbHistoryMeta } from '@/types';

export interface BackfillReport {
  /** 该图用过、但当前库中已不存在的 vibe id。 */
  missingVibeIds: string[];
}

export async function applyBackfill(meta: TlbHistoryMeta): Promise<BackfillReport> {
  promptDraft.text = meta.rawPrompt;

  // ---- 画师串 ----
  const artistText = meta.artistPrompt?.trim() ?? '';
  const byId = meta.artistId ? settings.artistPresets.find(a => a.id === meta.artistId) : null;
  const byText = artistText ? settings.artistPresets.find(a => a.prompt.trim() === artistText) : null;
  const match = byId ?? byText;
  if (match) {
    settings.activeArtistId = match.id;
    artistDraft.text = '';
  } else {
    // 预设不在了:下拉留空,内容进临时草稿(无串时保持「不使用」)
    settings.activeArtistId = '';
    artistDraft.text = artistText;
  }

  // ---- 词与参数(把当时解析后的值显式回填为覆写) ----
  settings.nai.qualityTags = meta.qualityTags ?? '';
  settings.nai.undesiredContent = meta.negative ?? '';
  settings.nai.model = meta.model;
  settings.nai.sampler = meta.sampler;
  settings.nai.steps = meta.steps;
  settings.nai.scale = meta.scale;
  settings.nai.cfgRescale = meta.cfgRescale;
  settings.nai.noiseSchedule = meta.noiseSchedule;
  // 尺寸已合并为单个「尺寸」选择框(生成只读 portraitSize),横竖都写它;
  // landscapeSize 同步保留,仅为柏宝绘同步兼容
  const sizeStr = `${meta.width}×${meta.height}`;
  settings.nai.portraitSize = sizeStr;
  settings.nai.landscapeSize = sizeStr;

  // ---- vibe 勾选状态(库未载完则跳过,避免误判全缺失) ----
  const missingVibeIds: string[] = [];
  if (vibeList.loaded) {
    const want = new Set(meta.vibeIds ?? []);
    for (const v of vibeList.items) {
      const on = want.has(v.id);
      if (v.enabled !== on) {
        v.enabled = on;
        await updateVibe(v);
      }
    }
    for (const id of want) {
      if (!vibeList.items.some(v => v.id === id)) missingVibeIds.push(id);
    }
  }

  return { missingVibeIds };
}
