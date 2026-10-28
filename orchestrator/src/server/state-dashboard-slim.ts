// 总览/仪表用的纯聚合与裁剪函数（从 state.ts 巨石析出的第一批：零外部依赖、纯函数）。
// 类型走 type-only import（编译期擦除，运行时不成环）。
import type { ArtifactSummary } from "../artifacts/store.js";
import type { FlowState } from "../runtime/flowstate.js";
import type { FlowWithLight, StateItem, PlanSummary, F07Dashboard } from "./state.js";

const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;

function finiteOrZero(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nonNegativeFiniteOrZero(value: number | undefined): number {
  const n = finiteOrZero(value);
  return n > 0 ? n : 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function buildF07Dashboard(
  flows: { status?: string; humanGate?: unknown; tokensUsed?: number; updatedAt?: number }[],
  nowMs: number,
): F07Dashboard {
  const now = finiteOrZero(nowMs);
  let verified = 0;
  let rolledBack = 0;
  let openHumanGates = 0;
  let tokens30d = 0;
  let tokensPrev30d = 0;

  for (const flow of flows) {
    if (flow.status === "verified") {
      verified += 1;
    } else if (flow.status === "rolled-back") {
      rolledBack += 1;
    }

    if (flow.humanGate !== undefined && (flow.status === "verified" || flow.status === "running")) {
      openHumanGates += 1;
    }

    const updatedAt = flow.updatedAt;
    if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) continue;
    const tokens = nonNegativeFiniteOrZero(flow.tokensUsed);
    if (updatedAt >= now - THIRTY_DAYS_MS && updatedAt <= now) {
      tokens30d += tokens;
    } else if (updatedAt >= now - 2 * THIRTY_DAYS_MS && updatedAt < now - THIRTY_DAYS_MS) {
      tokensPrev30d += tokens;
    }
  }

  const finished = verified + rolledBack;
  const autoCompletionPct = finished === 0 ? 0 : round1((verified / finished) * 100);
  const rollbackPct = finished === 0 ? 0 : round1(100 - autoCompletionPct);
  const costTrend: F07Dashboard["costTrend"] =
    tokensPrev30d === 0
      ? tokens30d > 0 ? "up" : "flat"
      : tokens30d < tokensPrev30d * 0.95
        ? "down"
        : tokens30d > tokensPrev30d * 1.05
          ? "up"
          : "flat";

  return { autoCompletionPct, rollbackPct, openHumanGates, tokens30d, tokensPrev30d, costTrend };
}

export function aggregateStageTokens(
  flows: { stageTokens?: Record<string, number> }[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const flow of flows) {
    for (const [stage, tokens] of Object.entries(flow.stageTokens ?? {})) {
      if (!Number.isFinite(tokens) || tokens <= 0) continue;
      totals[stage] = (totals[stage] ?? 0) + tokens;
    }
  }
  return totals;
}

export function slimFlowsForDashboard(
  flows: FlowWithLight[],
  opts?: { recentN?: number; previewLen?: number }
): FlowWithLight[] {
  const recentN = opts?.recentN ?? 40;
  const previewLen = opts?.previewLen ?? 200;
  return flows.slice(0, recentN).map((flow) => {
    const requirement = typeof flow.requirement === "string" && flow.requirement.length > previewLen
      ? `${flow.requirement.slice(0, previewLen)}…`
      : flow.requirement;
    return { ...flow, requirement };
  });
}

export function slimArtifactsForDashboard(
  artifacts: Record<string, StateItem[]>,
  opts?: { recentN?: number }
): Record<string, StateItem[]> {
  const recentN = opts?.recentN ?? 30;
  return Object.fromEntries(
    Object.entries(artifacts).map(([kind, items]) => [kind, items.slice(-recentN)])
  );
}

export function slimPlansForDashboard(plans: PlanSummary[], opts?: { recentN?: number }): PlanSummary[] {
  const recentN = opts?.recentN ?? 40;
  return plans.slice(-recentN);
}

export function isReviewFindingOpen(artifactStatus: string, finding: unknown): boolean {
  if (typeof finding !== "object" || finding === null) return false;

  const { severity, resolution } = finding as Record<string, unknown>;
  if (severity !== "warn" && severity !== "error") return false;
  if (artifactStatus === "verified" || artifactStatus === "rolled-back") return false;
  if (typeof resolution === "string" && resolution.trim().length > 0) return false;

  return true;
}

export function computeSystemLight(
  flows: Pick<FlowState, "status" | "blocker">[],
  arts: ArtifactSummary[]
): "red" | "yellow" | "green" {
  // 红 = 未解决的真问题：crashed 流，或非终态流挂着 active blocker。
  if (flows.some((f) => f.status === "crashed" || (f.status === "running" && Boolean(f.blocker)))) {
    return "red";
  }
  // 回滚是系统正确自愈（坏改动已还原），不告警——原因留在 history/experience，灯不因 rolled-back 变色。
  // 黄只来自 review 产物的 warn/error。
  const reviewArts = arts.filter((a) => a.kind === "review");
  for (const ra of reviewArts) {
    const findings = Array.isArray(ra.meta.findings) ? ra.meta.findings : [];
    for (const fnd of findings) {
      if (isReviewFindingOpen(ra.status, fnd)) {
        return "yellow";
      }
    }
  }

  return "green";
}
