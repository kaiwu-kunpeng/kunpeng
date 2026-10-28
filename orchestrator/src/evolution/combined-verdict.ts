import type { FitnessDelta } from "./fitness.js";
import type { ProductKpiDelta } from "./product-kpi.js";

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}
function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${round1(n)}`;
}

export interface CombinedVerdict {
  pass: boolean;
  reason: string;
  aReason: string;
  bReason: string;
}

/** 双维合并裁决：真进步 = A 不退化(净省工时 Δ≥0 ∧ 无 A 回归) ∧ B 改进(KPI 方向对的 Δ>0)。纯函数。 */
export function combinedVerdict(a: FitnessDelta, b: ProductKpiDelta): CombinedVerdict {
  const aOk = a.regressions.length === 0 && a.netSavedHoursDelta >= 0;
  const aReason = aOk
    ? `A 不退化(净省工时 Δ ${signed(a.netSavedHoursDelta)}h)`
    : `A 退化(${a.regressions.length ? a.regressions.join("、") : `净省工时 Δ ${signed(a.netSavedHoursDelta)}h`})`;
  const bReason = b.improved
    ? `${b.label} 改进(Δ ${signed(b.valueDelta)})`
    : `${b.label} 未改进(Δ ${signed(b.valueDelta)})`;
  const pass = aOk && b.improved;
  return { pass, reason: `${pass ? "真进步" : "未达标"}：${aReason} ∧ ${bReason}`, aReason, bReason };
}
