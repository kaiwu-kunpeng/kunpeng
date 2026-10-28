import { describe, expect, it } from "vitest";
import { aggregateReviewQueue, type ProjectSnapshot } from "../../src/server/state.js";

function snap(state: unknown): ProjectSnapshot {
  return { id: "p1", name: "P", repoPath: "/tmp/p", state } as unknown as ProjectSnapshot;
}

describe("收件箱汇聚看门狗告警(作者验收)", () => {
  it("health.alerts → kind:alert,区分卡死/长跑", () => {
    const q = aggregateReviewQueue([snap({
      humanGates: [], flows: [], artifacts: {}, blockers: [],
      health: { running: 1, healthy: 0, alerts: [
        { flowId: "f1", kind: "stuck", ageMs: 600000, stage: "implement" },
        { flowId: "f2", kind: "long-running", ageMs: 3600000, stage: "verify" },
      ] },
    })]);
    const alerts = q.filter((i) => i.kind === "alert");
    expect(alerts.length).toBe(2);
    expect(alerts.find((i) => i.id === "f1")!.title).toContain("卡死");
    expect(alerts.find((i) => i.id === "f2")!.title).toContain("长跑");
  });

  it("告警每项目最多 10 条", () => {
    const alerts = Array.from({ length: 13 }, (_v, i) => ({ flowId: "f" + i, kind: "stuck", ageMs: 1000, stage: "s" }));
    const q = aggregateReviewQueue([snap({ humanGates: [], flows: [], artifacts: {}, blockers: [], health: { running: 0, healthy: 0, alerts } })]);
    expect(q.filter((i) => i.kind === "alert").length).toBe(10);
  });
});
