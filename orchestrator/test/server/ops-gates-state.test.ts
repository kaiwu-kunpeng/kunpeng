import { describe, it, expect } from "vitest";
import { aggregateOpsGates, type ProjectSnapshot } from "../../src/server/state.js";

function snap(id: string, opsGates: unknown): ProjectSnapshot {
  return { id, name: id, state: { opsGates } as never } as unknown as ProjectSnapshot;
}

describe("aggregateOpsGates 跨项目聚合", () => {
  it("扁平聚合并回填 projectId", () => {
    const out = aggregateOpsGates([
      snap("pa", [{ id: "g1", projectId: "", playbookId: "p1", loopId: "l1", reason: "r", status: "pending", createdAt: 1 }]),
      snap("pb", [{ id: "g2", projectId: "pb", playbookId: "p2", loopId: "l2", reason: "r", status: "pending", createdAt: 2 }]),
      snap("pc", undefined),
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((g) => g.id === "g1")?.projectId).toBe("pa");
    expect(out.find((g) => g.id === "g2")?.projectId).toBe("pb");
  });

  it("空快照返回 []", () => {
    expect(aggregateOpsGates([])).toEqual([]);
  });
});