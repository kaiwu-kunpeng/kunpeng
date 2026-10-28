/** 产品 KPI（B 维）可插拔内核：每项目声明自己的北极星指标，方向感知比较。纯函数，无 I/O。 */

export interface ProductKpiSnapshot {
  key: string;
  label: string;
  value: number;
  higherBetter: boolean;  // 方向：越高越好(如自主度) / 越低越好(如逃逸率)
  detail?: string;
}

export interface ProductKpiDelta {
  key: string;
  label: string;
  valueDelta: number;     // candidate.value - baseline.value（原始有符号）
  improved: boolean;      // 方向感知：higherBetter ? Δ>0 : Δ<0
  detail?: string;
}

/** 一个项目的 KPI provider：从 repoRoot 读出当前快照（有 I/O，由各 provider 实现）。 */
export type KpiProvider = (repoRoot: string) => Promise<ProductKpiSnapshot>;

/** 方向感知比较：candidate vs baseline。纯函数。 */
export function compareKpi(baseline: ProductKpiSnapshot, candidate: ProductKpiSnapshot): ProductKpiDelta {
  const valueDelta = candidate.value - baseline.value;
  const improved = candidate.higherBetter ? valueDelta > 0 : valueDelta < 0;
  return {
    key: candidate.key,
    label: candidate.label,
    valueDelta,
    improved,
    ...(candidate.detail !== undefined && { detail: candidate.detail }),
  };
}
