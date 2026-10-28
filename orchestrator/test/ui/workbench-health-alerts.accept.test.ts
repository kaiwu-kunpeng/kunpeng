import { describe, expect, test } from "vitest";
import { renderWorkbench } from "../../src/server/ui/views/workbench.js";

type WorkbenchState = Parameters<typeof renderWorkbench>[0];

function stateWith(alerts: unknown[]): WorkbenchState {
  return {
    projects: [{ id: "p1", name: "p1" }],
    flows: [],
    humanGates: [],
    artifacts: {},
    health: { alerts, running: 2, healthy: 0 },
  } as unknown as WorkbenchState;
}

describe("工作台按 HealthAlert 对象渲染告警（作者锁定）", () => {
  test("长跑与卡住两类都渲染成可读文本，带 flowId、阶段与分钟数", () => {
    const html = renderWorkbench(stateWith([
      { flowId: "flow-long-1", kind: "long-running", ageMs: 1_800_000, stage: "implement" },
      { flowId: "flow-stuck-2", kind: "stuck", ageMs: 20_000, stage: "verify" },
    ]));
    expect(html).not.toContain("[object Object]");
    expect(html).toContain('data-flow="flow-long-1"');
    expect(html).toContain('data-flow="flow-stuck-2"');
    expect(html).toContain("长跑");
    expect(html).toContain("卡住");
    expect(html).toContain("30 分钟未收敛");
    expect(html).toContain("1 分钟未收敛");
    expect(html).toContain("verify");
  });

  test("flowId 里的 HTML 被转义", () => {
    const html = renderWorkbench(stateWith([
      { flowId: "<img src=x>", kind: "stuck", ageMs: 600_000, stage: "spec" },
    ]));
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;img src=x&gt;");
  });
});