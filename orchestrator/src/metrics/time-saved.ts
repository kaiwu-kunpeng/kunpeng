import { GUARDIAN_REINJECT_PREFIX } from "../feedback/finding-to-task.js";
import { classifyComplexity, type Complexity } from "../loop/complexity.js";

/** 人工工程当量基准(分钟):该复杂度任务,人类从理解到验证通过约需多久。保守取值,可随真实校准上调。 */
export const HUMAN_EQUIV_MINUTES: Record<Complexity, number> = { simple: 25, complex: 90 };

/** 真正消耗算力的工作阶段(用于 loop 成本时间跨度);gate-cleared/blocker-cleared/crashed/stopped/done 等不算。 */
const WORK_STAGES = new Set(["spec", "audit", "design", "implement", "review", "verify", "repair"]);

export type FlowKind = "dev" | "maintenance" | "data-ops";

export interface FlowLike {
  status: string;
  requirement: string;
  flowId?: string;
  planId?: string;
  predictedFiles?: string[];
  changedFileCount?: number;
  origin?: string;
  startedAt?: number;
  updatedAt?: number;
  history?: { stage: string; at?: number }[];
  tokensUsed?: number;
}

export interface FlowSaving {
  kind: FlowKind;
  verified: boolean;
  countedForNetSavings: boolean;
  complexity: Complexity;
  complexitySource: "changedFiles" | "predictedFiles" | "text";
  topLevel: boolean;
  humanEstimateMin: number;
  loopActualMin: number;
  netSavedMin: number;
}

export interface SavingsRollup {
  flows: number;
  topLevelFlows: number;
  planGroups: number;
  negativeFlows: number;
  complexityBySource: { changedFiles: number; predictedFiles: number; text: number };
  devFlows: number;
  maintenanceFlows: number;
  dataOpsFlows: number;
  verifiedDevFlows: number;
  humanEstimateHours: number;
  loopActualHours: number;
  netSavedHours: number;
  loopTokensUsed: number;
}

export interface SavingsAssumptions {
  humanEquivMinutes: Record<Complexity, number>;
  source: "default" | "env";
}

export interface SavingsV2 {
  v1: SavingsRollup;
  assumptions: SavingsAssumptions;
  assumptionsFlag?: string;
  maintenanceTaxHours: number;
  netAfterMaintenanceHours: number;
  loopTokensUsed: number;
}

function loopMinutes(f: FlowLike): number {
  // 工作阶段时间跨度(max-min),排除合并门等待:已合并流的 updatedAt 被 gate-cleared 撑到合并时刻,墙钟会虚高。
  const times = (Array.isArray(f.history) ? f.history : [])
    .filter((e) => WORK_STAGES.has(e.stage) && typeof e.at === "number")
    .map((e) => e.at as number);
  if (times.length >= 2) {
    return (Math.max(...times) - Math.min(...times)) / 60000;
  }
  // 回退:history 时间戳不足时才用墙钟。
  return f.startedAt != null && f.updatedAt != null && f.updatedAt > f.startedAt
    ? (f.updatedAt - f.startedAt) / 60000
    : 0;
}

export function flowKind(f: FlowLike): FlowKind {
  const history = Array.isArray(f.history) ? f.history : [];
  const hasImplement = history.some((h) => h.stage === "implement");
  if (!hasImplement) return "data-ops";
  if (f.origin === "guardian") return "maintenance";
  if (f.requirement.startsWith(GUARDIAN_REINJECT_PREFIX)) return "maintenance";
  return "dev";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function envPositiveMinutes(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function resolveHumanEquiv(env: NodeJS.ProcessEnv = process.env): SavingsAssumptions {
  const simple = envPositiveMinutes(env.KUNPENG_HUMAN_EQUIV_SIMPLE);
  const complex = envPositiveMinutes(env.KUNPENG_HUMAN_EQUIV_COMPLEX);
  const hasEnv = simple != null || complex != null;
  return {
    humanEquivMinutes: {
      simple: simple ?? HUMAN_EQUIV_MINUTES.simple,
      complex: complex ?? HUMAN_EQUIV_MINUTES.complex,
    },
    source: hasEnv ? "env" : "default",
  };
}

function legacyFlowKind(f: FlowLike): FlowKind {
  const history = Array.isArray(f.history) ? f.history : [];
  const hasImplement = history.some((h) => h.stage === "implement");
  if (!hasImplement) return "data-ops";
  if (f.requirement.startsWith(GUARDIAN_REINJECT_PREFIX)) return "maintenance";
  return "dev";
}

function legacyFlowSaving(
  f: FlowLike,
  opts: { humanEquiv?: Record<Complexity, number> } = {},
): Omit<FlowSaving, "complexitySource" | "topLevel"> {
  const kind = legacyFlowKind(f);
  const complexity = classifyComplexity(f.requirement).complexity;
  const estimateMin = (opts.humanEquiv ?? HUMAN_EQUIV_MINUTES)[complexity];
  const actualMin = loopMinutes(f);
  const verified = f.status === "verified";
  const countedForNetSavings = kind === "dev" && verified;
  const netSavedMin = countedForNetSavings ? Math.max(0, estimateMin - actualMin) : 0;
  return {
    kind,
    verified,
    countedForNetSavings,
    complexity,
    humanEstimateMin: estimateMin,
    loopActualMin: actualMin,
    netSavedMin,
  };
}

export function aggregateSavingsLegacy(
  flows: FlowLike[],
  opts: { humanEquiv?: Record<Complexity, number> } = {},
): SavingsRollup {
  let devFlows = 0;
  let maintenanceFlows = 0;
  let dataOpsFlows = 0;
  let verifiedDevFlows = 0;
  let estMin = 0;
  let actMin = 0;
  let netMin = 0;
  let loopTokensUsed = 0;

  for (const f of flows) {
    const s = legacyFlowSaving(f, opts);
    loopTokensUsed += f.tokensUsed ?? 0;
    if (s.kind === "dev") devFlows += 1;
    if (s.kind === "maintenance") maintenanceFlows += 1;
    if (s.kind === "data-ops") dataOpsFlows += 1;

    if (s.countedForNetSavings) {
      verifiedDevFlows += 1;
      estMin += s.humanEstimateMin;
      actMin += s.loopActualMin;
      netMin += s.netSavedMin;
    }
  }

  return {
    flows: flows.length,
    topLevelFlows: 0,
    planGroups: 0,
    negativeFlows: 0,
    complexityBySource: { changedFiles: 0, predictedFiles: 0, text: 0 },
    devFlows,
    maintenanceFlows,
    dataOpsFlows,
    verifiedDevFlows,
    humanEstimateHours: round1(estMin / 60),
    loopActualHours: round1(actMin / 60),
    netSavedHours: round1(netMin / 60),
    loopTokensUsed,
  };
}

export function resolveComplexity(f: FlowLike): { complexity: Complexity; source: FlowSaving["complexitySource"] } {
  if (typeof f.changedFileCount === "number" && Number.isFinite(f.changedFileCount) && f.changedFileCount >= 1) {
    return { complexity: f.changedFileCount > 1 ? "complex" : "simple", source: "changedFiles" };
  }
  if (Array.isArray(f.predictedFiles) && f.predictedFiles.length > 0) {
    return { complexity: f.predictedFiles.length > 1 ? "complex" : "simple", source: "predictedFiles" };
  }
  return { complexity: classifyComplexity(f.requirement).complexity, source: "text" };
}

export function flowSaving(
  f: FlowLike,
  opts: { humanEquiv?: Record<Complexity, number> } = {},
): FlowSaving {
  const kind = flowKind(f);
  const { complexity, source } = resolveComplexity(f);
  const humanEstimateMin = (opts.humanEquiv ?? HUMAN_EQUIV_MINUTES)[complexity];
  const loopActualMin = loopMinutes(f);
  const verified = f.status === "verified";
  const countedForNetSavings = kind === "dev" && verified;
  const netSavedMin = countedForNetSavings ? humanEstimateMin - loopActualMin : 0;
  return {
    kind,
    verified,
    countedForNetSavings,
    complexity,
    complexitySource: source,
    topLevel: !f.planId || f.planId === f.flowId,
    humanEstimateMin,
    loopActualMin,
    netSavedMin,
  };
}

export function aggregateSavings(
  flows: FlowLike[],
  opts: { humanEquiv?: Record<Complexity, number> } = {},
): SavingsRollup {
  let devFlows = 0;
  let maintenanceFlows = 0;
  let dataOpsFlows = 0;
  let verifiedDevFlows = 0;
  let estMin = 0;
  let actMin = 0;
  let netMin = 0;
  let loopTokensUsed = 0;
  let negativeFlows = 0;
  const complexityBySource = { changedFiles: 0, predictedFiles: 0, text: 0 };
  const standaloneUnits: FlowSaving[][] = [];
  const planGroups = new Map<string, FlowSaving[]>();

  for (const f of flows) {
    loopTokensUsed += f.tokensUsed ?? 0;
    // plan 父流只是容器；tokens 仍计入所有入参流。
    if (f.planId && f.planId === f.flowId) continue;
    const s = flowSaving(f, opts);
    if (f.planId && !s.topLevel) {
      const children = planGroups.get(f.planId) ?? [];
      children.push(s);
      planGroups.set(f.planId, children);
    } else {
      standaloneUnits.push([s]);
    }
  }

  const units = [...standaloneUnits, ...planGroups.values()];
  for (const children of units) {
    const verified = children.every((s) => s.verified);
    const kind = children.some((s) => s.kind === "dev") ? "dev"
      : children.some((s) => s.kind === "maintenance") ? "maintenance" : "data-ops";
    if (kind === "dev") devFlows += 1;
    if (kind === "maintenance") maintenanceFlows += 1;
    if (kind === "data-ops") dataOpsFlows += 1;

    if (kind === "dev" && verified) {
      const humanEstimateMin = children.reduce((sum, s) => sum + s.humanEstimateMin, 0);
      const loopActualMin = children.reduce((sum, s) => sum + s.loopActualMin, 0);
      const netSavedMin = humanEstimateMin - loopActualMin;
      verifiedDevFlows += 1;
      estMin += humanEstimateMin;
      actMin += loopActualMin;
      netMin += netSavedMin;
      if (netSavedMin < 0) negativeFlows += 1;
      for (const s of children) complexityBySource[s.complexitySource] += 1;
    }
  }

  return {
    flows: flows.length,
    topLevelFlows: units.length,
    planGroups: planGroups.size,
    negativeFlows,
    complexityBySource,
    devFlows,
    maintenanceFlows,
    dataOpsFlows,
    verifiedDevFlows,
    humanEstimateHours: round1(estMin / 60),
    loopActualHours: round1(actMin / 60),
    netSavedHours: round1(netMin / 60),
    loopTokensUsed,
  };
}

export function savingsV2(
  flows: FlowLike[],
  opts: { maintenanceMinutes?: number; env?: NodeJS.ProcessEnv } = {},
): SavingsV2 {
  const assumptions = resolveHumanEquiv(opts.env);
  const v1 = aggregateSavings(flows, { humanEquiv: assumptions.humanEquivMinutes });
  const maintenanceTaxHours = round1((opts.maintenanceMinutes ?? 0) / 60);
  return {
    v1,
    assumptions,
    ...(assumptions.source === "env" ? {
      assumptionsFlag: "人工当量由环境变量 KUNPENG_HUMAN_EQUIV_* 覆盖，已记审计行",
    } : {}),
    maintenanceTaxHours,
    netAfterMaintenanceHours: round1(v1.netSavedHours - maintenanceTaxHours),
    loopTokensUsed: v1.loopTokensUsed,
  };
}

/** 按月(UTC YYYY-MM,以 updatedAt 为准;缺 updatedAt 的流归入 "unknown")分桶汇总。 */
export function savingsByMonth(flows: FlowLike[]): Record<string, SavingsRollup> {
  const buckets = new Map<string, FlowLike[]>();
  for (const f of flows) {
    const month = f.updatedAt != null ? new Date(f.updatedAt).toISOString().slice(0, 7) : "unknown";
    const arr = buckets.get(month) ?? [];
    arr.push(f);
    buckets.set(month, arr);
  }

  const out: Record<string, SavingsRollup> = {};
  for (const [month, arr] of buckets) out[month] = aggregateSavings(arr);
  return out;
}
