/**
 * Vibe 列表的会话内状态:完整条目数组 + 增删改 + 取启用集合 + Vibe 组。
 * 正文(base64 编码)就在条目里,量级小,直接全量驻留内存。
 *
 * 与小白X 的差异:TagLab 没有「画师串预设保存」这个闸门,勾选/强度直接挂在
 * vibe 条目上、即时落盘;Vibe 组是勾选+强度的命名快照,选组即把快照写回各条目
 * (不在组内的条目一律停用)。
 */
import { reactive } from 'vue';

import { clampVibeStrength } from '@/constants';
import { newId, settings } from '@/state/settings';
import { clearVibes, deleteVibe, listVibes, saveVibe } from '@/storage/vibes';
import type { TlbVibe, TlbVibeGroup, TlbVibeGroupMember } from '@/types';

export const vibeList = reactive<{
  items: TlbVibe[];
  loaded: boolean;
}>({
  items: [],
  loaded: false,
});

/** 当前选中的 Vibe 组 id;空串 = 未选组。 */
export const vibeSelection = reactive<{ groupId: string }>({ groupId: '' });

export async function loadVibes(): Promise<void> {
  const items = await listVibes();
  // 旧库没有 infoExtracted 字段 / busy 一律清掉
  vibeList.items = items.map(v => ({
    ...v,
    infoExtracted: v.infoExtracted === 0 ? 0 : 1,
    busy: false,
  }));
  vibeList.loaded = true;
}

export async function addVibe(vibe: TlbVibe): Promise<void> {
  await saveVibe(vibe);
  vibeList.items.unshift(vibe);
}

/** 原地改字段后落盘(开关/强度/改名/编码都走它)。 */
export async function updateVibe(vibe: TlbVibe): Promise<void> {
  await saveVibe(vibe);
}

/** ✕ 从库删除:同步修剪所有 Vibe 组(成员清空的组一并删除)与组选择。 */
export async function removeVibe(id: string): Promise<void> {
  await deleteVibe(id);
  const idx = vibeList.items.findIndex(v => v.id === id);
  if (idx >= 0) vibeList.items.splice(idx, 1);
  pruneGroups([id]);
}

/** 清空 vibe 库(库 + 内存 + 组 + 选择)。 */
export async function wipeVibes(): Promise<void> {
  await clearVibes();
  vibeList.items = [];
  settings.vibeGroups = [];
  vibeSelection.groupId = '';
}

/** 当前启用且强度 > 0 的 vibe(生成时叠加)。 */
export function enabledVibes(): TlbVibe[] {
  return vibeList.items.filter(v => v.enabled && v.strength > 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// Vibe 组
// ═══════════════════════════════════════════════════════════════════════════

/** 从组里修剪已删除的 vibe 引用;成员清空的组删除;选中组失效则取消选择。 */
function pruneGroups(removedIds: string[]): void {
  const removed = new Set(removedIds);
  for (const g of settings.vibeGroups) {
    g.members = g.members.filter(m => !removed.has(m.id));
  }
  for (let i = settings.vibeGroups.length - 1; i >= 0; i--) {
    if (!settings.vibeGroups[i].members.length) settings.vibeGroups.splice(i, 1);
  }
  if (vibeSelection.groupId && !settings.vibeGroups.some(g => g.id === vibeSelection.groupId)) {
    vibeSelection.groupId = '';
  }
}

/**
 * 套用组:成员的勾选/强度写回各 vibe 条目(库里已删除的成员跳过);
 * 不在组内的 vibe 一律停用。空 id = 仅取消选择,不改勾选。
 */
export async function applyVibeGroup(groupId: string): Promise<void> {
  if (!groupId) {
    vibeSelection.groupId = '';
    return;
  }
  const group = settings.vibeGroups.find(g => g.id === groupId);
  if (!group) {
    vibeSelection.groupId = '';
    return;
  }
  const members = new Map(group.members.map(m => [m.id, m]));
  for (const v of vibeList.items) {
    const m = members.get(v.id);
    const enabled = !!m && m.enabled !== false;
    const strength = m ? clampVibeStrength(m.strength, 0.6) : v.strength;
    if (v.enabled !== enabled || v.strength !== strength) {
      v.enabled = enabled;
      v.strength = strength;
      await saveVibe(v);
    }
  }
  vibeSelection.groupId = group.id;
}

/** 当前启用 vibe 的勾选+强度快照(存组用)。 */
function snapshotEnabledMembers(): TlbVibeGroupMember[] {
  return vibeList.items
    .filter(v => v.enabled)
    .map(v => ({ id: v.id, enabled: true, strength: clampVibeStrength(v.strength, 0.6) }));
}

/** 把当前勾选与强度另存为新组;没有勾选任何 vibe 时返回 null。 */
export function saveVibeGroupAs(name: string): TlbVibeGroup | null {
  const members = snapshotEnabledMembers();
  if (!members.length) return null;
  return addVibeGroup(name, members);
}

/** 导入等场景:直接用给定成员建组(允许含禁用成员)。建组不自动选中,需手动套用。 */
export function addVibeGroup(name: string, members: TlbVibeGroupMember[]): TlbVibeGroup {
  const group: TlbVibeGroup = {
    id: newId('vibegroup'),
    name: name.slice(0, 60),
    members,
  };
  settings.vibeGroups.push(group);
  return group;
}

/** 💾 覆盖指定组为当前勾选与强度;组不存在或无勾选项时返回 null。 */
export function overwriteVibeGroup(groupId: string): TlbVibeGroup | null {
  const group = settings.vibeGroups.find(g => g.id === groupId);
  if (!group) return null;
  const members = snapshotEnabledMembers();
  if (!members.length) return null;
  group.members = members;
  return group;
}

export function renameVibeGroup(groupId: string, name: string): TlbVibeGroup | null {
  const group = settings.vibeGroups.find(g => g.id === groupId);
  if (!group) return null;
  group.name = name.trim().slice(0, 60) || group.name;
  return group;
}

/** 删除组(组内 vibe 保留);删的是当前选中组则取消选择。 */
export function deleteVibeGroup(groupId: string): void {
  const idx = settings.vibeGroups.findIndex(g => g.id === groupId);
  if (idx < 0) return;
  settings.vibeGroups.splice(idx, 1);
  if (vibeSelection.groupId === groupId) vibeSelection.groupId = '';
}
