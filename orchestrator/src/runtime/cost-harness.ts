/** 「每美元产出」看板（升级调研 U14）：按 harness 配置（implement 后端 × 模型 × effort）比较近 N 天真实流的
 *  verified 数、回滚率、token、估算美元与每美元 verified 数，给模型/档位升级决策一个量化依据。
 *  计价复用 cost-pricing 的 estimateCostUsd（与月度报表同一口径），不另写价目表。纯函数。 */
import { isRecord } from "../util/is-record.js";
import { estimateCostUsd } from "./cost-pricing.js";

/** 每组至少这么多条真实流才下结论。 */
export const MIN_HARNESS_SAMPLE = 5;

export interface HarnessFlow {
  flowId?: string;
  status?: string;
  startedAt?: number;
  backend?: string;
  stageTokens?: Record<string, number>;
  stageModels?: Record<string, string>;
  stageBackends?: Record<string, string>;
}

export interface HarnessRow {
  backend: string;
  model: string;
  effort: string;
  flows: number;
  verified: number;
  rollbackRate: number;
  tokens: number;
  usd: number;
  /** usd 为 0 时 null。 */
  verifiedPerUsd: number | null;
  insufficient: boolean;
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" && field.trim() !== "" ? field : undefined;
}

/** implement 阶段的 harness：后端、模型、effort（模型串 @ 后），缺省分别记 unknown / unknown / default。 */
export function harnessOf(flow: HarnessFlow): { backend: string; model: string; effort: string } {
  const backend = stringField(flow.stageBackends, "implement") ?? (typeof flow.backend === "string" ? flow.backend : undefined) ?? "unknown";
  const raw = stringField(flow.stageModels, "implement") ?? "unknown";
  const at = raw.indexOf("@");
  return at >= 0
    ? { backend, model: raw.slice(0, at) || "unknown", effort: raw.slice(at + 1) || "default" }
    : { backend, model: raw, effort: "default" };
}

/** 一条流的估算美元：逐阶段按该阶段模型（缺省后端名）计价，与月度报表口径一致。 */
export function flowUsd(flow: HarnessFlow): { tokens: number; usd: number } {
  let tokens = 0;
  let usd = 0;
  if (!isRecord(flow.stageTokens)) return { tokens, usd };
  for (const [stage, value] of Object.entries(flow.stageTokens)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    const label = stringField(flow.stageModels, stage) ?? stringField(flow.stageBackends, stage) ?? flow.backend ?? "unknown";
    tokens += value;
    usd += estimateCostUsd({ [label]: value }).totalUsd;
  }
  return { tokens, usd };
}

export function buildHarnessYield(flows: readonly HarnessFlow[], opts: { sinceMs: number }): HarnessRow[] {
  const groups = new Map<string, HarnessRow>();
  for (const flow of flows) {
    if (typeof flow.flowId !== "string" || flow.flowId.startsWith("plan-")) continue;
    if (flow.status !== "verified" && flow.status !== "rolled-back") continue;
    if (typeof flow.startedAt !== "number" || flow.startedAt < opts.sinceMs) continue;
    const h = harnessOf(flow);
    const key = `${h.backend}|${h.model}|${h.effort}`;
    const row = groups.get(key) ?? { ...h, flows: 0, verified: 0, rollbackRate: 0, tokens: 0, usd: 0, verifiedPerUsd: null, insufficient: true };
    const cost = flowUsd(flow);
    row.flows += 1;
    if (flow.status === "verified") row.verified += 1;
    row.tokens += cost.tokens;
    row.usd += cost.usd;
    groups.set(key, row);
  }
  const rows = [...groups.values()].map((row) => ({
    ...row,
    usd: Math.round(row.usd * 100) / 100,
    rollbackRate: row.flows > 0 ? (row.flows - row.verified) / row.flows : 0,
    verifiedPerUsd: row.usd > 0 ? row.verified / row.usd : null,
    insufficient: row.flows < MIN_HARNESS_SAMPLE,
  }));
  return rows.sort((a, b) => {
    if (a.insufficient !== b.insufficient) return a.insufficient ? 1 : -1;
    return (b.verifiedPerUsd ?? -1) - (a.verifiedPerUsd ?? -1);
  });
}

export function renderHarnessYield(rows: readonly HarnessRow[], days: number): string {
  if (rows.length === 0) return `近 ${days} 天没有已终结的真实流`;
  const lines = [`每美元产出（近 ${days} 天，按 implement 后端 × 模型 × effort；样本 < ${MIN_HARNESS_SAMPLE} 条标「样本不足」）`];
  for (const row of rows) {
    const perUsd = row.verifiedPerUsd === null ? "—" : row.verifiedPerUsd.toFixed(3);
    lines.push(
      `- ${row.backend} / ${row.model} / ${row.effort}：流 ${row.flows}，verified ${row.verified}，回滚率 ${(row.rollbackRate * 100).toFixed(1)}%，`
        + `token ${row.tokens}，约 $${row.usd.toFixed(2)}，每美元 verified ${perUsd}${row.insufficient ? "（样本不足）" : ""}`,
    );
  }
  return lines.join("\n");
}
