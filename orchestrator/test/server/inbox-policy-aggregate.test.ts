import { describe, expect, it } from "vitest";
import { aggregateReviewQueue, countActionableGates, reviewItemOrder, type ProjectSnapshot, type ReviewItem } from "../../src/server/state.js";

const HOUR = 3_600_000;
function snap(id: string, state: unknown): ProjectSnapshot {
  return { id, name: `项目${id}`, repoPath: `/tmp/${id}`, state } as unknown as ProjectSnapshot;
}
function mergeGate(flowId: string, gateOpenedAt: number, tier: "human" | "auto" = "human") {
  return {
    gate: { flowId, what: `合并主干 kp/${flowId} → main`, detail: "d" },
    flow: { flowId, status: "verified", stage: "done", gateOpenedAt, mergeTier: { tier, reasons: [], ruleIds: [], mode: "report", at: 1 } },
  };
}

describe("过期降级 / 日配额 / 缺席（作者锁定）", () => {
  it("合并门按 gateOpenedAt+ttl 过期，运营门按 createdAt+ttl；过期条目仍在队列但 expired=true 且排同级末尾", () => {
    const now = 1_000 * HOUR;
    const g1 = mergeGate("fresh", now - 1 * HOUR);
    const g2 = mergeGate("stale", now - 200 * HOUR);
    const q = aggregateReviewQueue([snap("proj-a", {
      humanGates: [g2.gate, g1.gate], flows: [g2.flow, g1.flow], artifacts: {}, blockers: [], health: { alerts: [], running: 0, healthy: 0 },
      opsGates: [{ id: "og-old", projectId: "proj-a", playbookId: "p", loopId: "l", reason: "r", status: "pending", createdAt: now - 170 * HOUR }],
    })], { now, policy: { dailyHardCapPerProject: 5, gateTtlHours: 168 } });
    const by = (id: string) => q.find((i) => i.id === id)!;
    expect(by("fresh").decision?.expiresAt).toBe(now - 1 * HOUR + 168 * HOUR);
    expect(by("fresh").decision?.expired).toBeUndefined();
    expect(by("stale").decision?.expired).toBe(true);
    expect(by("og-old").decision?.expired).toBe(true);
    expect(reviewItemOrder([by("stale"), by("fresh")]).map((i) => i.id)).toEqual(["fresh", "stale"]);
  });

  it("日配额：每项目只放前 N 条硬门，其余 heldByCap；软门与另一项目不受影响；侧栏计数剔除 held 与 expired", () => {
    const now = 1_000 * HOUR;
    const gates = ["h1", "h2", "h3", "h4", "h5", "h6", "h7"].map((id) => mergeGate(id, now - HOUR));
    const soft = mergeGate("soft", now - HOUR, "auto");
    const other = mergeGate("other-h1", now - HOUR);
    const q = aggregateReviewQueue([
      snap("proj-a", { humanGates: [...gates.map((g) => g.gate), soft.gate], flows: [...gates.map((g) => g.flow), soft.flow], artifacts: {}, blockers: [], health: { alerts: [], running: 0, healthy: 0 } }),
      snap("proj-b", { humanGates: [other.gate], flows: [other.flow], artifacts: {}, blockers: [{ flowId: "b-1", stage: "implement", reason: "等待输入" }], health: { alerts: [], running: 0, healthy: 0 } }),
    ], { now, policy: { dailyHardCapPerProject: 5, gateTtlHours: 168 } });
    const held = q.filter((i) => i.decision?.heldByCap).map((i) => i.id);
    expect(held).toEqual(["h6", "h7"]);
    expect(q.find((i) => i.id === "soft")!.decision?.heldByCap).toBeUndefined();
    expect(q.find((i) => i.id === "other-h1")!.decision?.heldByCap).toBeUndefined();
    expect(countActionableGates(q)).toBe(q.length - 2);
  });

  it("缺席窗口内所有硬门 absent=true，软门不标；窗口过了不标", () => {
    const now = 1_000 * HOUR;
    const hard = mergeGate("hard", now - HOUR);
    const soft = mergeGate("soft", now - HOUR, "auto");
    const state = { humanGates: [hard.gate, soft.gate], flows: [hard.flow, soft.flow], artifacts: {}, blockers: [], health: { alerts: [], running: 0, healthy: 0 } };
    const inAbsence = aggregateReviewQueue([snap("proj-a", state)], { now, policy: { dailyHardCapPerProject: 5, gateTtlHours: 168, absence: { until: now + HOUR } } });
    expect(inAbsence.find((i) => i.id === "hard")!.decision?.absent).toBe(true);
    expect(inAbsence.find((i) => i.id === "soft")!.decision?.absent).toBeUndefined();
    const after = aggregateReviewQueue([snap("proj-a", state)], { now, policy: { dailyHardCapPerProject: 5, gateTtlHours: 168, absence: { until: now - 1 } } });
    expect(after.find((i) => i.id === "hard")!.decision?.absent).toBeUndefined();
  });

  it("不传 policy → 默认策略（5 条、168h），行为与第二片一致", () => {
    const now = 1_000 * HOUR;
    const g = mergeGate("x", now - HOUR);
    const q = aggregateReviewQueue([snap("proj-a", { humanGates: [g.gate], flows: [g.flow], artifacts: {}, blockers: [], health: { alerts: [], running: 0, healthy: 0 } })], { now });
    const item = q[0] as ReviewItem;
    expect(item.decision?.expiresAt).toBe(now - HOUR + 168 * HOUR);
    expect(item.decision?.heldByCap).toBeUndefined();
  });
});