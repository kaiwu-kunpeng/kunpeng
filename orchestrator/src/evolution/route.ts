/**
 * 自我进化 · 提案路由（宪法 C8：确定性优先）。
 *
 * 把已构建的进化提案（ProposedChange[]）按"拟改目标"分派到四个去向。
 * 纯函数、零 I/O、不调用 LLM：同输入同输出，不改入参。
 *
 * 禁区判定**只消费** evolution/policy.ts 的 targetForbidden，
 * 绝不在此重建禁区路径表/兜底正则——单一真相源。
 */

import type { ProposedChange } from "../loop/self-evolution.js";
import { targetForbidden } from "./policy.js";

/** 路由结果：四个去向，互斥且穷尽（守恒）。 */
export interface RoutedChanges {
  /** 拟改可调约定。 */
  conventions: ProposedChange[];
  /** 拟做依赖/工具升级。 */
  upgrades: ProposedChange[];
  /** 拟固化蒸馏技能。 */
  skills: ProposedChange[];
  /** 禁区兜底 + 未知目标——不静默丢弃，留待人核。 */
  unrouted: ProposedChange[];
}

/**
 * 按目标把提案分派到四去向（按优先级，命中即停）：
 *   1) targetForbidden(target) → unrouted（禁区兜底，优先级最高，压过其它匹配）
 *   2) target === "conventions" → conventions
 *   3) target === "upgrade"     → upgrades
 *   4) target === "skills"      → skills
 *   5) 其余未知                 → unrouted（不静默丢弃）
 *
 * 不变式：守恒（四去向长度和=入参长度）、保序（各去向内部保持入参相对顺序）、纯函数。
 */
export function route(changes: ProposedChange[]): RoutedChanges {
  const conventions: ProposedChange[] = [];
  const upgrades: ProposedChange[] = [];
  const skills: ProposedChange[] = [];
  const unrouted: ProposedChange[] = [];
  for (const c of changes) {
    if (targetForbidden(c.target)) {
      unrouted.push(c); // 禁区兜底，优先级最高。
    } else if (c.target === "conventions") {
      conventions.push(c);
    } else if (c.target === "upgrade") {
      upgrades.push(c);
    } else if (c.target === "skills") {
      skills.push(c);
    } else {
      unrouted.push(c); // 未知目标不静默丢弃。
    }
  }
  return { conventions, upgrades, skills, unrouted };
}
