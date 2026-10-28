import { expect, test } from "vitest";
import { aggregateCrossProjectRunning } from "../src/server/state.js";
import { renderOverview } from "../src/server/ui/views/overview.js";
import type { DashboardState, ProjectSnapshot } from "../src/server/state.js";

function snap(id: string, name: string, running: { flowId: string; startedAt: number }[]): ProjectSnapshot {
  return {
    id, name, repoPath: "/" + id,
    state: {
      agents: 1,
      flows: [], running: running.map((r) => ({
        flowId: r.flowId, requirement: "做事", stage: "implement", status: "running",
        agentActive: true, startedAt: r.startedAt, updatedAt: r.startedAt, history: [], light: "green",
      })) as DashboardState["running"],
      blockers: [], humanGates: [], artifacts: {}, branches: [], statusCounts: {},
      systemLight: "green", agentAssignments: [], patrol: { pendingCount: 0, lastRunText: "" },
      plans: [], code: { srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0 },
      designCandidates: [], health: { alerts: [], running: 0, healthy: 0 },
      activity: { total: 0, verified: 0, rolledBack: 0, successRate: 1, recent: [] },
    },
  };
}

test("aggregateCrossProjectRunning 合并各项目在跑流，每条带 project 标注，按 startedAt 降序", () => {
  const snaps = [
    snap("kunpeng", "鲲鹏", [{ flowId: "k1", startedAt: 100 }]),
    snap("repo", "DemoTravel.ai", [{ flowId: "r1", startedAt: 300 }, { flowId: "r2", startedAt: 200 }]),
  ];
  const merged = aggregateCrossProjectRunning(snaps);
  expect(merged.map((f) => f.flowId)).toEqual(["r1", "r2", "k1"]); // 按 startedAt 降序
  expect(merged[0].project).toEqual({ id: "repo", name: "DemoTravel.ai" });
  expect(merged[2].project).toEqual({ id: "kunpeng", name: "鲲鹏" });
});

test("总览「在跑什么」每行渲染项目标注", () => {
  const state = snap("kunpeng", "鲲鹏", []).state;
  state.running = aggregateCrossProjectRunning([
    snap("kunpeng", "鲲鹏", [{ flowId: "k1", startedAt: 100 }]),
    snap("repo", "DemoTravel.ai", [{ flowId: "r1", startedAt: 200 }]),
  ]);
  const html = renderOverview(state);
  expect(html).toContain("鲲鹏");
  expect(html).toContain("DemoTravel.ai");
});
