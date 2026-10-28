// 巡检/自我进化 · 跨轮去重纯函数层（宪法 C8 确定性优先）。
// 无 I/O、无副作用：在生成新一批提案 change 前，剔除已在待审提案产物里出现过的 change，
// 防止跨轮重复提案堆积。
import type { ProposedChange } from "./self-evolution.js";
import type { Artifact } from "../artifacts/types.js";

/** 身份键：target + 换行 + text；不参与 source 比较。 */
export function changeKey(c: ProposedChange): string {
  return `${c.target}\n${c.text}`;
}

/**
 * 从全部待审提案产物里收集已出现过的 change 键。
 * 防御性：meta / meta.proposal / .changes 缺失或 .changes 非数组时跳过该产物，不抛错。
 */
export function collectPendingKeys(pending: Artifact[]): Set<string> {
  const keys = new Set<string>();
  for (const art of pending) {
    const changes = (art.meta as { proposal?: { changes?: unknown } } | undefined)?.proposal?.changes;
    if (!Array.isArray(changes)) continue;
    for (const c of changes as ProposedChange[]) keys.add(changeKey(c));
  }
  return keys;
}

/**
 * 将一批 change 分流为 fresh / duplicate：
 *  - 键已在 pendingKeys，或本批内已出现过 → duplicate；
 *  - 否则 → fresh（同键本批仅首次入 fresh）。
 * 保持输入顺序。
 */
export function dedupeChanges(
  changes: ProposedChange[],
  pendingKeys: Set<string>,
): { fresh: ProposedChange[]; duplicate: ProposedChange[] } {
  const fresh: ProposedChange[] = [];
  const duplicate: ProposedChange[] = [];
  const seen = new Set<string>(pendingKeys);
  for (const c of changes) {
    const key = changeKey(c);
    if (seen.has(key)) {
      duplicate.push(c);
    } else {
      seen.add(key);
      fresh.push(c);
    }
  }
  return { fresh, duplicate };
}
