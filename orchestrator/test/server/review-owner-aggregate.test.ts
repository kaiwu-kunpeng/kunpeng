import { describe, expect, it } from "vitest";
import { aggregateReviewQueue, reviewItemOwners, type ProjectSnapshot } from "../../src/server/state.js";

function snap(id: string, state: unknown): ProjectSnapshot {
  return { id, name: `项目${id}`, repoPath: `/tmp/${id}`, state } as unknown as ProjectSnapshot;
}

describe("收件箱条目回填目标 owner（作者锁定）", () => {
  it("merge 走 flow.goalId、ops-gate 走 loop.goalId；查不到不写 owner 键；reviewItemOwners 去重升序", () => {
    const q = aggregateReviewQueue([snap("proj-a", {
      goals: [
        { id: "goal-links", owner: "alice", statement: "内链", status: "active" },
        { id: "goal-geo", owner: "bob", statement: "GEO", status: "active" },
      ],
      loops: [{ id: "pz-links", name: "L", goalId: "goal-links", summary: {}, metric: { label: "x", current: 1 }, waveCount: 0, recent: [], levers: { active: [], needsDev: [], honestZero: [] }, gotchas: [] }],
      opsGates: [{ id: "og-1", projectId: "proj-a", playbookId: "pb", loopId: "pz-links", reason: "r", status: "pending", createdAt: 1 }],
      humanGates: [
        { flowId: "f-owned", what: "合并主干 kp/f-owned → main", detail: "d" },
        { flowId: "f-geo", what: "合并主干 kp/f-geo → main", detail: "d" },
        { flowId: "f-none", what: "合并主干 kp/f-none → main", detail: "d" },
        { flowId: "f-orphan", what: "合并主干 kp/f-orphan → main", detail: "d" },
      ],
      flows: [
        { flowId: "f-owned", status: "verified", stage: "done", goalId: "goal-links" },
        { flowId: "f-geo", status: "verified", stage: "done", goalId: "goal-geo" },
        { flowId: "f-none", status: "verified", stage: "done" },
        { flowId: "f-orphan", status: "verified", stage: "done", goalId: "goal-missing" },
      ],
      artifacts: {},
      blockers: [],
      health: { alerts: [], running: 0, healthy: 0 },
    })], { now: 10 });
    const by = (id: string) => q.find((i) => i.id === id)!;
    expect(by("f-owned").decision?.owner).toBe("alice");
    expect(by("f-geo").decision?.owner).toBe("bob");
    expect(by("og-1").decision?.owner).toBe("alice");
    expect(by("f-none").decision).toBeDefined();
    expect("owner" in (by("f-none").decision ?? {})).toBe(false);
    expect("owner" in (by("f-orphan").decision ?? {})).toBe(false);
    expect(reviewItemOwners(q)).toEqual(["alice", "bob"]);
    expect(reviewItemOwners([])).toEqual([]);
  });
});