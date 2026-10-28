import { test, expect } from "vitest";
import { renderArchitecture } from "../../src/server/ui/views/architecture.js";
import { renderViewFragment } from "../../src/server/ui/render-view.js";

const state = {
  systemLight: "green",
  running: [{ flowId: "f1" }, { flowId: "f2" }],
  humanGates: [{ what: "门#1 合并主干", detail: "", flowId: "f1" }],
  patrol: { pendingCount: 3, lastRunText: "x" },
  reinjectBacklog: { pending: 5 },
} as unknown as import("../../src/server/state.js").DashboardState;

test("是 Cytoscape 图（挂载点 + 节点/边数据，不是纯卡片）", () => {
  const html = renderArchitecture(state);
  expect(html).toContain('id="cy-arch"');        // 图挂载点
  expect(html).toContain("data-arch");           // 节点/边数据嵌在挂载点上，前端 cytoscape 渲染
  expect((html.match(/&quot;source&quot;/g) ?? []).length).toBeGreaterThan(3); // 多条边(每条边一个 source)
});

test("含核心环 + 飞轮 + 自进化关键节点标签", () => {
  const html = renderArchitecture(state);
  for (const label of ["Spec", "Implement", "Verify", "门#1", "main", "Patrol", "门#2", "Reinject"]) {
    expect(html).toContain(label);
  }
});

test("活体数字叠在图上", () => {
  const html = renderArchitecture(state);
  expect(html).toContain("3");  // patrol pendingCount → 门#2 badge
  expect(html).toContain("5");  // reinject backlog → 飞轮 badge
  expect(html).toContain("2");  // running → plan badge
});

test("部分/空 state 不崩（防御式）", () => {
  expect(() => renderArchitecture({} as unknown as import("../../src/server/state.js").DashboardState)).not.toThrow();
});

test("render-view 仍把 #/architecture 路由到本视图", () => {
  expect(renderViewFragment(state, "#/architecture")).toBe(renderArchitecture(state));
});
