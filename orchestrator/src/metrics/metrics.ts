export interface AutoCompletion {
  attempted: number;
  autoCompleted: number;
  neededIntervention: number;
  rate: number;
  target: number;
  meetsTarget: boolean;
}

export function computeAutoCompletion(flows: { status: string }[]): AutoCompletion {
  const autoCompleted = flows.filter((flow) => flow.status === "verified").length;
  const neededIntervention = flows.filter(
    (flow) =>
      flow.status === "rolled-back" ||
      flow.status === "crashed" ||
      flow.status === "stopped",
  ).length;
  const attempted = autoCompleted + neededIntervention;
  const rate = attempted === 0 ? 1 : autoCompleted / attempted;
  const target = 0.8;

  return {
    attempted,
    autoCompleted,
    neededIntervention,
    rate,
    target,
    meetsTarget: rate >= target,
  };
}

export interface TokenTrend {
  samples: number;
  avgTokensPerReq: number;
  recentAvg: number;
  olderAvg: number;
  trend: "down" | "up" | "flat";
}

interface TokenSample {
  tokensUsed: number;
  updatedAt: number;
}

function avgTokens(samples: TokenSample[]): number {
  return samples.length > 0
    ? samples.reduce((total, sample) => total + sample.tokensUsed, 0) / samples.length
    : 0;
}

export function computeTokenTrend(
  flows: { status: string; tokensUsed?: number; updatedAt: number }[],
): TokenTrend {
  const samples = flows
    .filter(
      (flow): flow is TokenSample & { status: string } =>
        flow.status === "verified" &&
        typeof flow.tokensUsed === "number" &&
        flow.tokensUsed > 0,
    )
    .sort((a, b) => a.updatedAt - b.updatedAt);

  if (samples.length === 0) {
    return { samples: 0, avgTokensPerReq: 0, recentAvg: 0, olderAvg: 0, trend: "flat" };
  }

  const mid = Math.floor(samples.length / 2);
  const older = samples.slice(0, mid);
  const recent = samples.slice(mid);
  const olderAvg = avgTokens(older);
  const recentAvg = avgTokens(recent);
  let trend: TokenTrend["trend"] = "flat";

  if (mid > 0) {
    if (recentAvg < olderAvg * 0.95) {
      trend = "down";
    } else if (recentAvg > olderAvg * 1.05) {
      trend = "up";
    }
  }

  return {
    samples: samples.length,
    avgTokensPerReq: avgTokens(samples),
    recentAvg,
    olderAvg,
    trend,
  };
}

const GATE_KINDS = ["合并主干", "改宪法", "对外发布"] as const;
export type GateKind = (typeof GATE_KINDS)[number] | "unknown";

export function classifyGate(gate: { gate: string; what: string }): GateKind {
  const s = `${gate.gate} ${gate.what}`;
  if (/合并|merge|→\s*main/i.test(s)) return "合并主干";
  if (/宪法|角色卡|constitution|\bcore\b/i.test(s)) return "改宪法";
  if (/发布|对外|release|publish/i.test(s)) return "对外发布";
  return "unknown";
}

export interface GateConservation {
  ok: boolean;
  allowed: readonly string[];
  violations: { gate: string; what: string }[];
}

export function checkGateConservation(gates: { gate: string; what: string }[]): GateConservation {
  const violations = gates.filter((gate) => classifyGate(gate) === "unknown");
  return { ok: violations.length === 0, allowed: GATE_KINDS, violations };
}
