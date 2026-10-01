/**
 * 画师库「生成对比」运行态(独立于组件的单例)。
 *
 * 组件用 v-if 挂载,把运行态放这里可保证切 tab / 组件重挂不丢进度。
 * 口径沿用旧对比页:artistPrompt = 该预设 prompt;quality / negative 用预设绑定值,
 * 留空回落全局覆写;同一轮共用一个种子,画师串是唯一变量。
 * 顺序生成,每张之间按 settings.compareInterval 的秒数范围随机等待(防风控);
 * 等待可被「停止」打断,未开始的行标记 stopped。
 */
import { reactive } from 'vue';

import { naiRandomSeed, parseResolution } from '@/constants';
import { generateNaiImage } from '@/nai/client';
import { addHistory } from '@/state/historyList';
import { activeEndpoint, globalQualityTags, globalUndesired, settings } from '@/state/settings';
import { imageUrl, promptDraft } from '@/state/ui';
import { notify } from '@/st/toast';

export type CompareRowStatus = 'waiting' | 'generating' | 'done' | 'error' | 'stopped';

export interface CompareRunRow {
  presetId: string;
  name: string;
  status: CompareRowStatus;
  error: string;
  imageId: string;
  seed: number;
  /** 本行实际出图尺寸(完成后写入);等待行用开跑时的设置尺寸预填,0 = 未知。 */
  width: number;
  height: number;
}

export const compareRun = reactive({
  running: false,
  rows: [] as CompareRunRow[],
  /** imageId → 可展示地址。 */
  urls: {} as Record<string, string>,
  /** 本轮共用种子。 */
  seed: 0,
  /** 停止请求(下一条开始前 / 等待间隔内生效)。 */
  stopRequested: false,
});

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 在设置的 [min,max] 秒间取随机等待毫秒;min==max = 固定;都为 0 = 不等。 */
function randomDelayMs(): number {
  const { minSec, maxSec } = settings.compareInterval;
  const min = Math.max(0, minSec * 1000);
  const max = Math.max(min, maxSec * 1000);
  if (max <= 0) return 0;
  return min + Math.random() * (max - min);
}

/** 请求停止(仅运行中有意义)。 */
export function stopCompareRun(): void {
  if (compareRun.running) compareRun.stopRequested = true;
}

export async function startCompareRun(presetIds: string[]): Promise<void> {
  if (compareRun.running) return;
  const presets = settings.artistPresets.filter(a => presetIds.includes(a.id));
  if (!presets.length) {
    notify('warning', '先勾选要对比的画师');
    return;
  }
  if (!promptDraft.text.trim()) {
    notify('warning', '先在「生成」页写正向提示词');
    return;
  }
  if (!activeEndpoint().key.trim()) {
    notify('warning', '未配置 NAI API Key:到「设置」填写');
    return;
  }

  // 开跑瞬间的尺寸:预填给等待行占位;每张完成后以实际出图尺寸覆盖
  let startW = 0;
  let startH = 0;
  try {
    const r = parseResolution(settings.nai.portraitSize || '832×1216');
    startW = r.width;
    startH = r.height;
  } catch {
    /* 尺寸非法时等待行不预设比例,由组件兜底 */
  }

  compareRun.stopRequested = false;
  compareRun.running = true;
  compareRun.rows = presets.map(p => ({
    presetId: p.id,
    name: p.name,
    status: 'waiting' as const,
    error: '',
    imageId: '',
    seed: 0,
    width: startW,
    height: startH,
  }));
  compareRun.seed = settings.nai.seed > 0 ? settings.nai.seed : naiRandomSeed();

  let stopped = false;
  for (let i = 0; i < presets.length; i++) {
    const p = presets[i];
    // 按 presetId 取行:用户可能在生成过程中拖拽结果排序,数组下标会变
    const row = compareRun.rows.find(r => r.presetId === p.id)!;
    // 第一条立即出图,之后每条开始前先看停止标志
    if (compareRun.stopRequested) {
      stopped = true;
      break;
    }
    row.status = 'generating';
    try {
      const res = await generateNaiImage({
        prompt: promptDraft.text,
        seed: compareRun.seed,
        artistPrompt: p.prompt,
        qualityTags: p.quality.trim() || globalQualityTags(),
        negative: p.negative.trim() || globalUndesired(),
      });
      await addHistory(res.meta, res.blob);
      row.imageId = res.meta.id;
      row.seed = res.meta.seed;
      // 本行实际尺寸:若运行中途切换过尺寸,各行框比例也能各自精确
      row.width = res.meta.width;
      row.height = res.meta.height;
      row.status = 'done';
      compareRun.urls[res.meta.id] = (await imageUrl(res.meta.id)) ?? '';
    } catch (e) {
      // 单张失败不中断整轮
      row.status = 'error';
      row.error = e instanceof Error ? e.message : String(e);
    }

    // 最后一张不用等;等待期间分片睡眠,停止可即时打断
    if (i < presets.length - 1) {
      const waitMs = randomDelayMs();
      const step = 250;
      let waited = 0;
      while (waited < waitMs) {
        if (compareRun.stopRequested) break;
        const slice = Math.min(step, waitMs - waited);
        await delay(slice);
        waited += slice;
      }
      if (compareRun.stopRequested) {
        stopped = true;
        break;
      }
    }
  }

  if (stopped) {
    for (const r of compareRun.rows) {
      if (r.status === 'waiting') r.status = 'stopped';
    }
  }
  compareRun.running = false;
  compareRun.stopRequested = false;
}

/** 清空上一轮结果(运行中禁用)。 */
export function clearCompareResults(): void {
  if (compareRun.running) return;
  compareRun.rows = [];
  compareRun.urls = {};
  compareRun.seed = 0;
}
