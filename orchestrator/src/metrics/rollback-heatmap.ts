import type { FlowState, FlowTracker } from "../runtime/flowstate.js";
import { classifyFailureText } from "../loop/rollback-attribution.js";

export const REAL_STAGES = ["spec", "audit", "implement", "verify"] as const;

export function deriveFailureStage(flow: Pick<FlowState, "history" | "stage">): string {
  for (let i = flow.history.length - 1; i >= 0; i--) {
    const { stage } = flow.history[i];
    if (REAL_STAGES.some((realStage) => realStage === stage)) return stage;
  }
  return "unknown";
}

export function deriveBackend(flow: Pick<FlowState, "backend" | "stageBackends">, stage: string): string {
  return flow.stageBackends?.[stage] ?? flow.backend ?? "unknown";
}

export interface Attribution { kind: string; summary: string; source: "rollback" | "backfill" | "none" }

export function attributionFor(flow: FlowState): Attribution {
  if (flow.rollback?.kind) {
    return {
      kind: flow.rollback.kind,
      summary: flow.rollback.summary,
      source: flow.rollback.source === "backfill" ? "backfill" : "rollback",
    };
  }
  const text = flow.failureReason ?? flow.blocker ?? "";
  return text
    ? { ...classifyFailureText(text), source: "none" }
    : { kind: "unknown", summary: "", source: "none" };
}

export const HEATMAP_STATUSES = ["rolled-back", "crashed"] as const;

export interface HeatmapCell { kind: string; stage: string; backend: string; count: number; flowIds: string[] }
export interface RollbackHeatmap {
  cells: HeatmapCell[];
  kinds: string[];
  stages: string[];
  backends: string[];
  coverage: { total: number; attributed: number; unknown: number; pct: number };
}

export function buildRollbackHeatmap(flows: readonly FlowState[], opts: { sinceMs?: number } = {}): RollbackHeatmap {
  const groups = new Map<string, HeatmapCell>();
  let total = 0;
  let unknown = 0;
  for (const flow of flows) {
    if (!HEATMAP_STATUSES.some((status) => status === flow.status) ||
      (opts.sinceMs !== undefined && !(flow.updatedAt >= opts.sinceMs))) continue;
    const { kind } = attributionFor(flow);
    const stage = deriveFailureStage(flow);
    const backend = deriveBackend(flow, stage);
    const key = `${kind}|${stage}|${backend}`;
    let cell = groups.get(key);
    if (!cell) {
      cell = { kind, stage, backend, count: 0, flowIds: [] };
      groups.set(key, cell);
    }
    cell.count++;
    cell.flowIds.push(flow.flowId);
    total++;
    if (kind === "unknown") unknown++;
  }
  const cells = [...groups.values()].sort((a, b) => b.count - a.count ||
    a.kind.localeCompare(b.kind) || a.stage.localeCompare(b.stage) || a.backend.localeCompare(b.backend));
  for (const cell of cells) cell.flowIds.sort();
  const attributed = total - unknown;
  return {
    cells,
    kinds: [...new Set(cells.map((cell) => cell.kind))].sort(),
    stages: [...new Set(cells.map((cell) => cell.stage))].sort(),
    backends: [...new Set(cells.map((cell) => cell.backend))].sort(),
    coverage: { total, attributed, unknown, pct: total === 0 ? 0 : Math.round(attributed / total * 1000) / 10 },
  };
}

export function renderHeatmapText(h: RollbackHeatmap): string {
  const { pct, attributed, total, unknown } = h.coverage;
  const lines = [`回滚归因覆盖率 ${pct}%（${attributed}/${total}，unknown ${unknown} 不计）`];
  if (h.cells.length === 0) return lines[0];
  for (const kind of h.kinds) {
    const cells = h.cells.filter((cell) => cell.kind === kind);
    const summarize = (axis: "stage" | "backend", values: string[]): string => values
      .map((value) => ({ value, count: cells.filter((cell) => cell[axis] === value).reduce((sum, cell) => sum + cell.count, 0) }))
      .filter(({ count }) => count > 0)
      .map(({ value, count }) => `${value}=${count}`)
      .join(" ");
    lines.push(`${kind}: ${summarize("stage", h.stages)} ｜ 后端 ${summarize("backend", h.backends)}`);
  }
  return lines.join("\n");
}

export async function backfillRollbackAttribution(
  tracker: FlowTracker,
  opts: { dryRun?: boolean },
): Promise<{ scanned: number; updated: number; skippedHasRollback: number; unknown: number; entries: { flowId: string; kind: string }[] }> {
  const flows = await tracker.list();
  const result = { scanned: 0, updated: 0, skippedHasRollback: 0, unknown: 0, entries: [] as { flowId: string; kind: string }[] };
  for (const flow of flows) {
    if (!HEATMAP_STATUSES.some((status) => status === flow.status)) continue;
    result.scanned++;
    if (flow.rollback?.kind) {
      result.skippedHasRollback++;
      continue;
    }
    const { kind, summary } = classifyFailureText(flow.failureReason ?? flow.blocker ?? "");
    if (kind === "unknown") {
      result.unknown++;
      continue;
    }
    result.entries.push({ flowId: flow.flowId, kind });
    if (!opts.dryRun) {
      await tracker.setRollback(flow.flowId, { kind, summary, attempt: 0, source: "backfill" });
      result.updated++;
    }
  }
  return result;
}
