import { describe, expect, it } from "vitest";
import { buildGateStats, collectGateLedger, formatGateStatsReport } from "../../src/metrics/gate-ledger.js";
import type { GateLedgerEntry } from "../../src/runtime/flowstate.js";

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;
function entry(over: Partial<GateLedgerEntry>): GateLedgerEntry {
  return { gate: "合并主干 (人工门#1)", what: "kp/x → main", openedAt: T0, closedAt: T0 + DAY, durationMs: 60_000, by: "human", via: "cockpit-merge", planGate: false, ...over };
}
const flows = [
  { flowId: "a", gateLedger: [entry({ closedAt: T0 + 1 * DAY, durationMs: 60_000, durationTier: "short" })], humanGate: undefined },
  { flowId: "b", gateLedger: [entry({ closedAt: T0 + 2 * DAY, durationMs: 120_000 })], humanGate: { gate: "合并主干 (人工门#1)", what: "kp/b → main" } },
  { flowId: "plan-c", gateLedger: [entry({ closedAt: T0 + 3 * DAY, durationMs: 600_000, planGate: true, durationTier: "long" })], humanGate: undefined },
  { flowId: "d", gateLedger: [entry({ closedAt: T0 + 4 * DAY, by: "machine", via: "autopilot-cli" })], humanGate: undefined },
  { flowId: "e", gateLedger: [entry({ closedAt: T0 + 5 * DAY, by: "unknown", via: "unattributed" })], humanGate: undefined },
  { flowId: "old", gateLedger: [entry({ closedAt: T0 - 1 * DAY, by: "human" })], humanGate: undefined },
  { flowId: "none", humanGate: undefined },
];
const window = { sinceMs: T0, untilMs: T0 + 14 * DAY };

describe("gate-ledger 统计", () => {
  it("collectGateLedger 只取窗口内条目并按 closedAt 升序", () => {
    const rows = collectGateLedger(flows, window);
    expect(rows.map((r) => r.closedAt)).toEqual([T0 + DAY, T0 + 2 * DAY, T0 + 3 * DAY, T0 + 4 * DAY, T0 + 5 * DAY]);
  });

  it("buildGateStats：人/机/未归因分开数，父流门单独数，中位数与三档正确", () => {
    const s = buildGateStats(flows, window);
    expect(s.weeks).toBe(2);
    expect(s.human).toBe(3);
    expect(s.machine).toBe(1);
    expect(s.unknown).toBe(1);
    expect(s.planGates).toBe(1);
    expect(s.humanPerWeek).toBe(1.5);
    expect(s.machinePerWeek).toBe(0.5);
    expect(s.medianHumanDurationMs).toBe(120_000);
    expect(s.tiers).toEqual({ short: 1, medium: 0, long: 1, unset: 1 });
    expect(s.openNow).toBe(1);
  });

  it("没有人批的门 → 中位数 null；空窗口 weeks 不为 0", () => {
    const s = buildGateStats([{ flowId: "d", gateLedger: [entry({ by: "machine" })], humanGate: undefined }], { sinceMs: T0, untilMs: T0 });
    expect(s.medianHumanDurationMs).toBeNull();
    expect(s.weeks).toBeGreaterThan(0);
  });

  it("formatGateStatsReport 含五个口径标签", () => {
    const text = formatGateStatsReport(buildGateStats(flows, window), "kunpeng");
    for (const label of ["人批的门/周", "机器自动清的门/周", "每扇门时长中位", "父流的门", "未归因"]) expect(text).toContain(label);
    expect(text).toContain("2.0");
  });
});