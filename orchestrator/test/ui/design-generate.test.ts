import { describe, expect, test } from "vitest";
import type { DashboardState } from "../../src/server/state.js";
import { renderViewFragment } from "../../src/server/ui/render-view.js";
import { clientScript } from "../../src/server/ui/client.js";
import { designGenerateArgs } from "../../src/server/launch.js";

function fixture(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    agents: 0, flows: [], running: [], blockers: [], humanGates: [], artifacts: {},
    branches: [], statusCounts: {}, systemLight: "green", agentAssignments: [],
    patrol: { pendingCount: 0, lastRunText: "尚未巡检" }, plans: [],
    code: { srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0 },
    designCandidates: [], health: { alerts: [], running: 0, healthy: 0 },
    ...overrides,
  } as DashboardState;
}

describe("#7 面板异步生成", () => {
  test("designGenerateArgs 纯函数:含 design-loop/--generate/--rounds/--out/--brief", () => {
    const a = designGenerateArgs("/t/b.json", "/t/out", "/repo", { seed: "#E2620E", anchors: ["Swiss", "Organic"], rounds: 3 });
    expect(a[0]).toBe("design-loop");
    expect(a).toContain("--generate");
    expect(a).toContain("--brief"); expect(a).toContain("/t/b.json");
    expect(a).toContain("--out"); expect(a).toContain("/t/out");
    expect(a).toContain("--rounds"); expect(a).toContain("3");
    expect(a).toContain("--seed"); expect(a).toContain("#E2620E");
    expect(a).toContain("--anchors"); expect(a).toContain("Swiss,Organic");
    expect(() => designGenerateArgs("", "/o", "/r")).toThrow();
  });

  test("设计 tab 有生成按钮 + 回炉轮数输入", () => {
    const html = renderViewFragment(fixture(), "#/project/kunpeng/design", { projectName: "kunpeng" });
    expect(html).toContain('data-action="design-generate"');
    expect(html).toContain("data-dl-rounds");
  });

  test("client 接线:design-generate handler 调 /api/design-generate", () => {
    expect(clientScript).toContain('action === "design-generate"');
    expect(clientScript).toContain("/api/design-generate");
  });
});
