import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abandonFlow } from "../../src/runtime/flow-abandon.js";
import { renderOverview } from "../../src/server/ui/views/overview.js";
import type { FlowState } from "../../src/runtime/flowstate.js";
import type { DashboardState } from "../../src/server/state.js";

describe("abandonFlow", () => {
  it("中止后置 rolled-back + 清门 + 记 history", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-ab-"));
    try {
      const fid = "flowK";
      writeFileSync(join(dir, fid + ".json"), JSON.stringify({
        flowId: fid, requirement: "x", stage: "implement", status: "running", agentActive: false,
        humanGate: { gate: "合并主干", what: "kp/flowK → main" }, startedAt: 1, updatedAt: 1, history: [],
      }));
      const r = await abandonFlow(dir, fid);
      expect(r.ok).toBe(true);
      const after = JSON.parse(readFileSync(join(dir, fid + ".json"), "utf8"));
      expect(after.status).toBe("rolled-back");
      expect(after.agentActive).toBe(false);
      expect(after.humanGate == null).toBe(true);
      expect(after.history.some((h: FlowState["history"][number]) => h.stage === "abandoned")).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("flow 不存在 → ok:false", async () => {
    expect((await abandonFlow(tmpdir(), "nope-" + Math.random())).ok).toBe(false);
  });
});

function ovFixture(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    agents: 0, flows: [], running: [], blockers: [], humanGates: [], artifacts: {}, branches: [],
    statusCounts: {}, systemLight: "green", agentAssignments: [],
    patrol: { pendingCount: 0, lastRunText: "尚未巡检" }, plans: [],
    code: { srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0 },
    designCandidates: [], health: { alerts: [], running: 0, healthy: 0 },
    activity: { total: 0, verified: 0, rolledBack: 0, successRate: 1, recent: [] },
    ...overrides,
  };
}

describe("overview 健康告警一键中止", () => {
  it("告警渲成带中止按钮的行", () => {
    const html = renderOverview(ovFixture({
      health: { alerts: [{ flowId: "flowK", kind: "stuck", ageMs: 700000, stage: "implement" }], running: 1, healthy: 0 },
    }));
    expect(html).toContain('data-action="abandon-flow"');
    expect(html).toContain("flowK");
  });
});
