import { buildEscapeRateFromLogs, gitLogsForEscapeRate } from "../metrics/escape-rate-report.js";
import type { EscapeRate } from "../metrics/escape-rate.js";
import type { ProductKpiSnapshot } from "./product-kpi.js";

/** 鲲鹏样板的 B-KPI：自主度 = 1 − 逃逸率（合并后又回滚的比例越低越自主）。纯函数。 */
export function autonomyFromEscapeRate(er: EscapeRate): ProductKpiSnapshot {
  return {
    key: "autonomy",
    label: "自主度",
    value: 1 - er.rate,
    higherBetter: true,
    detail: `merged ${er.mergedCount} · escaped ${er.escapedCount}`,
  };
}

/** 鲲鹏 autonomy provider：从 repoRoot 的 git 历史算逃逸率（git 失败安全回退空）→ 自主度快照。 */
export async function autonomyKpiProvider(repoRoot: string): Promise<ProductKpiSnapshot> {
  const { mergedLog, revertLog } = await gitLogsForEscapeRate(repoRoot);
  return autonomyFromEscapeRate(buildEscapeRateFromLogs(mergedLog, revertLog, []));
}
