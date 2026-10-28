import { describe, expect, it } from "vitest";
import { aggregateReviewQueue, isHardGate, type ProjectSnapshot, type ReviewItem } from "../../src/server/state.js";
import { sortReviewItemsByAttention } from "../../src/server/ui/views/review-inbox.js";

function snap(state: unknown): ProjectSnapshot {
  return { id: "proj-a", name: "项目A", repoPath: "/tmp/proj-a", state } as unknown as ProjectSnapshot;
}
const item = (kind: ReviewItem["kind"], id: string, blast?: "L2" | "L3" | "L4", verdict?: "approve" | "reject" | "review"): ReviewItem => ({
  projectId: "proj-a", projectName: "项目A", kind, id, title: id, detail: "d",
  ...(blast ? { decision: { action: "x", blastRadius: blast } } : {}),
  ...(verdict ? { preReview: { verdict, reason: "r", at: 1 } } : {}),
});

describe("稍后过滤、硬门判定、爆炸半径排序（作者锁定）", () => {
  it("deferred 集合按 <kind>:<id> 剔除，运营门用 ops: 前缀", () => {
    const q = aggregateReviewQueue([snap({
      humanGates: [
        { flowId: "f-1", what: "合并主干 kp/f-1 → main", detail: "d" },
        { flowId: "f-2", what: "合并主干 kp/f-2 → main", detail: "d" },
      ],
      flows: [], artifacts: {}, blockers: [], health: { alerts: [], running: 0, healthy: 0 },
      opsGates: [
        { id: "og-1", projectId: "proj-a", playbookId: "p", loopId: "l", reason: "r", status: "pending", createdAt: 1 },
        { id: "og-2", projectId: "proj-a", playbookId: "p", loopId: "l", reason: "r", status: "pending", createdAt: 1 },
      ],
    })], { now: 10, deferred: new Set(["merge:f-1", "ops:og-2"]) });
    expect(q.map((i) => `${i.kind}:${i.id}`)).toEqual(["merge:f-2", "ops-gate:og-1"]);
  });

  it("isHardGate：L3/L4 是硬门，L2 与无 decision 不是", () => {
    expect(isHardGate(item("merge", "a", "L3"))).toBe(true);
    expect(isHardGate(item("release", "b", "L4"))).toBe(true);
    expect(isHardGate(item("merge", "c", "L2"))).toBe(false);
    expect(isHardGate(item("failed", "d"))).toBe(false);
  });

  it("排序：L4 → L3 → L2 → 无 decision；同级内仍按预审结论，再按原序", () => {
    const sorted = sortReviewItemsByAttention([
      item("failed", "n1"),
      item("merge", "l2-approve", "L2", "approve"),
      item("merge", "l3-b", "L3"),
      item("release", "l4", "L4"),
      item("merge", "l3-a", "L3", "reject"),
      item("merge", "l2-reject", "L2", "reject"),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["l4", "l3-a", "l3-b", "l2-reject", "l2-approve", "n1"]);
  });
});