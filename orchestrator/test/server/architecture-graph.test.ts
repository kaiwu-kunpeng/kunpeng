import { test, expect } from "vitest";
import { buildArchitectureGraph } from "../../src/server/ui/views/architecture-graph.js";
import { renderArchitecture } from "../../src/server/ui/views/architecture.js";

const state = {
  systemLight: "green",
  running: [{ flowId: "f1", stage: "implement" }],
  humanGates: [{ what: "门#1 合并主干", detail: "", flowId: "f1" }],
  blockers: [{ flowId: "f2", stage: "verify", reason: "x" }],
  patrol: { pendingCount: 3, lastRunText: "x" },
  reinjectBacklog: { pending: 5 },
} as unknown as import("../../src/server/state.js").DashboardState;

function byId(g: ReturnType<typeof buildArchitectureGraph>) {
  return Object.fromEntries(g.nodes.map((n) => [n.id, n]));
}

test("在跑的 stage 节点 = running，有 blocker 的 = failed", () => {
  const m = byId(buildArchitectureGraph(state));
  expect(m.impl.state).toBe("running");   // running flow at implement
  expect(m.verify.state).toBe("failed");  // blocker at verify
  expect(m.spec.state).toBe("idle");      // 没在跑也没坏
});

test("门有待办 = waiting，main 按系统灯，空闲 = idle", () => {
  const m = byId(buildArchitectureGraph(state));
  expect(m.gate1.state).toBe("waiting");  // 合并门
  expect(m.gate2.state).toBe("waiting");  // patrol pending
  expect(m.main.state).toBe("done");      // green
  expect(m.guardian.state).toBe("idle");  // 无活信号=没在工作
});

test("state class 进 classes，badge 保留", () => {
  const m = byId(buildArchitectureGraph(state));
  expect(m.impl.classes).toContain("s-running");
  expect(m.gate2.badge).toBe(3);
  expect(m.reinject.badge).toBe(5);
  expect(m.plan.badge).toBe(1);
});

test("systemLight red → main failed", () => {
  const m = byId(buildArchitectureGraph({ ...state, systemLight: "red" } as unknown as import("../../src/server/state.js").DashboardState));
  expect(m.main.state).toBe("failed");
});

test("空 state 不崩，节点都有合法 state", () => {
  const g = buildArchitectureGraph({} as unknown as import("../../src/server/state.js").DashboardState);
  expect(g.nodes.length).toBeGreaterThan(0);
  for (const n of g.nodes) expect(["running","idle","waiting","done","failed"]).toContain(n.state);
});

test("视图含状态图例 + 容器", () => {
  const html = renderArchitecture(state);
  expect(html).toContain('id="cy-arch"');
  expect(html).toContain("系统架构");
});
