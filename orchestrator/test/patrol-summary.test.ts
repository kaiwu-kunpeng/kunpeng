import { describe, it, expect } from "vitest";
import type { Artifact } from "../src/artifacts/types.js";
import { summarizePatrol } from "../src/server/patrol-summary.js";

function mk(id: string, status: Artifact["status"]): Artifact {
  return { kind: "proposal", id, status, body: "", meta: {} };
}

describe("summarizePatrol", () => {
  const proposals: Artifact[] = [
    mk("p1", "draft"),
    mk("p2", "approved"),
    mk("p3", "draft"),
    mk("p4", "verified"),
  ];

  it("counts only draft proposals and renders last run text", () => {
    expect(summarizePatrol(proposals, 1781411901119)).toEqual({
      pendingCount: 2,
      lastRunText: "上次巡检 @1781411901119",
    });
  });

  it("returns zero pending and '尚未巡检' for empty input without lastPatrolAt", () => {
    expect(summarizePatrol([])).toEqual({
      pendingCount: 0,
      lastRunText: "尚未巡检",
    });
  });

  it("treats lastPatrolAt === 0 as already patrolled (not falsy)", () => {
    expect(summarizePatrol([], 0)).toEqual({
      pendingCount: 0,
      lastRunText: "上次巡检 @0",
    });
  });
});
