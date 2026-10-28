import { describe, expect, it } from "vitest";
import { aggregateReviewQueue, type ProjectSnapshot } from "../../src/server/state.js";

function snap(id: string, state: unknown): ProjectSnapshot {
  return { id, name: `项目${id}`, repoPath: `/tmp/${id}`, state } as unknown as ProjectSnapshot;
}

describe("收件箱条目带结构化决策块（作者锁定）", () => {
  it("merge 从 mergeTier/changedFileCount/budget 推出 L3、证据与成本；proposal/release/connector 定级；通知类无 decision", () => {
    const q = aggregateReviewQueue([snap("proj-a", {
      humanGates: [
        { flowId: "f-hum", what: "合并主干 kp/f-hum → main", detail: "d", preReview: { verdict: "review", reason: "改了敏感路径", at: 1 } },
        { flowId: "f-auto", what: "合并主干 kp/f-auto → main", detail: "d" },
        { flowId: "p-1", what: "批准进化提案 (人工门#2)", detail: "p", preReview: { verdict: "approve", reason: "小改动", at: 1 } },
      ],
      flows: [
        { flowId: "f-hum", status: "verified", stage: "done", changedFileCount: 7, budget: { level: "ok", reason: "", scope: "flow", spentUsd: 3.25, spentTokens: 1, at: 1 },
          mergeTier: { tier: "human", reasons: ["触及敏感路径 src/server/authz.ts"], ruleIds: ["sensitive-path"], mode: "report", at: 1 } },
        { flowId: "f-auto", status: "verified", stage: "done", mergeTier: { tier: "auto", reasons: [], ruleIds: [], mode: "report", at: 1 } },
        { flowId: "dead-1", requirement: "崩了", status: "crashed", blocker: "OOM", updatedAt: 5 },
      ],
      artifacts: {
        release: [{ id: "rel-1", kind: "release", status: "draft", summary: "build: npm run build" }],
        connector: [{ id: "conn-1", kind: "connector", status: "draft", summary: "调用退款 connector" }],
      },
      blockers: [{ flowId: "b-1", stage: "implement", reason: "等待输入" }],
      health: { alerts: [], running: 0, healthy: 0 },
    })], { now: 10 });
    const by = (id: string) => q.find((i) => i.id === id)!;
    expect(by("f-hum").decision).toEqual({
      action: "merge-main", blastRadius: "L3", evidence: "触及敏感路径 src/server/authz.ts；改动 7 个文件", reasoning: "改了敏感路径", costUsd: 3.25,
    });
    expect(by("f-auto").decision?.blastRadius).toBe("L2");
    expect(by("f-auto").decision?.evidence).toBeUndefined();
    expect(by("p-1").decision).toEqual({ action: "approve-apply", blastRadius: "L3", reasoning: "小改动" });
    expect(by("rel-1").decision).toEqual({ action: "confirm-release", blastRadius: "L4", evidence: "build: npm run build" });
    expect(by("conn-1").decision).toEqual({ action: "approve-connector", blastRadius: "L3", evidence: "调用退款 connector" });
    expect(by("dead-1").decision).toBeUndefined();
    expect(by("b-1").decision).toBeUndefined();
  });

  it("pending 运营门进队列成 ops-gate 条目（旧门未记等级按 L3），非 pending 不进；位置在 connector 之后、failed 之前", () => {
    const q = aggregateReviewQueue([snap("proj-b", {
      humanGates: [], flows: [{ flowId: "dead-2", requirement: "x", status: "stopped", updatedAt: 5 }],
      artifacts: { connector: [{ id: "conn-2", kind: "connector", status: "draft", summary: "s" }] },
      opsGates: [
        { id: "og-1", projectId: "proj-b", playbookId: "pz-internal-links", loopId: "pz-links", reason: "review 门", status: "pending", createdAt: 1 },
        { id: "og-2", projectId: "proj-b", playbookId: "x", loopId: "x", reason: "已决", status: "approved", createdAt: 1, decidedAt: 2, decidedBy: { by: "human", via: "cockpit" } },
      ],
      blockers: [], health: { alerts: [], running: 0, healthy: 0 },
    })], { now: 10 });
    expect(q.map((i) => `${i.kind}:${i.id}`)).toEqual(["connector:conn-2", "ops-gate:og-1", "failed:dead-2"]);
    const og = q.find((i) => i.id === "og-1")!;
    expect(og.title).toBe("pz-internal-links");
    expect(og.detail).toBe("review 门");
    expect(og.decision).toEqual({ action: "ops-gate-approve", blastRadius: "L3", evidence: "loop pz-links", expiresAt: 1 + 168 * 3_600_000 });
  });
});