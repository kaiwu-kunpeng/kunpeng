/**
 * 自我进化 · 计划审计门（OWASP LLM05「输出当不可信」；宪法 C6 进化护栏、C8 确定性优先）。
 *
 * LLM 生成的"计划/提案" Markdown 属于不可信输出：在它被应用、或其拟执行命令被运行之前，
 * 复用已定基座 policy.ts 的 findViolations 做 grep 级确定性扫描，命中任一危险模式即判不安全。
 *
 * fail-closed：当且仅当零违规才放行 (safe=true)；任何命中即拦 (safe=false)。
 * 纯函数、零 I/O：不自定义危险模式、不调用 LLM——判定权完全委托给基座，单一真相源。
 */
import { findViolations, findForbiddenPathRefs, type Violation } from "./policy.js";

/** 计划审计结论。 */
export interface PlanAuditResult {
  /** 是否安全放行：当且仅当无任何违规 (fail-closed)。 */
  safe: boolean;
  /** 命中的全部违规（空数组 = 安全）。 */
  violations: Violation[];
}

/**
 * 审计一份 LLM 生成的计划 Markdown。
 * 把整份文本交给基座 findViolations 做确定性危险命令扫描，按 fail-closed 判定 safe。
 */
export function auditGeneratedPlan(planMd: string): PlanAuditResult {
  // 两条互补的确定性扫描：危险命令 + 禁区路径引用（两者皆命中即拦，fail-closed）。
  const violations = [...findViolations(planMd), ...findForbiddenPathRefs(planMd)];
  return { safe: violations.length === 0, violations };
}
