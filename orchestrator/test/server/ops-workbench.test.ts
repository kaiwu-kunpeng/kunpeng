import { clientSource } from "../helpers/client-source.js";
import { httpSource } from "../helpers/http-source.js";
import { stateSource } from "../helpers/state-source.js";
import { describe, it, expect } from "vitest";
import { renderLoops } from "../../src/server/ui/views/loops.js";
import type { DashboardState } from "../../src/server/state.js";

function stateWithNeedsDevLever(): DashboardState {
  return {
    loops: [{
      id: "l1",
      projectId: "p1",
      name: "测试 loop",
      metric: { label: "PWQ", current: 10 },
      waveCount: 0,
      recent: [],
      leversByStatus: {
        active: [],
        needsDev: [{ id: "lv-1", label: "补抓取器", status: "needs-dev" }],
        honestZero: [],
      },
      gotchas: [],
      summary: "",
      waves: [],
    }],
    playbooks: [],
  } as unknown as DashboardState;
}

describe("运营工作台接线（源码级断言）", () => {
  it("state.ts 聚合 playbooks", () => {
    const src = stateSource();
    expect(src).toContain("listPlaybooks");
    expect(src).toContain("playbooks");
  });

  it("loops 视图渲染 playbook 卡片与 needs-dev 转任务按钮", () => {
    const html = renderLoops(stateWithNeedsDevLever());
    expect(html).toContain("Playbook");
    expect(html).toContain('data-action="lever-to-task"');
    expect(html).toContain("needs-dev");
  });

  it("http.ts 端点用 createTask 建 ops-dev 任务", () => {
    const src = httpSource();
    const idx = src.indexOf('"/api/loop-lever-to-task"');
    expect(idx).toBeGreaterThan(-1);
    const window = src.slice(idx, idx + 2500);
    expect(window).toContain("createTask");
    expect(window).toContain("ops-dev");
    expect(window).toContain("ready");
  });

  it("client 源码 有 lever-to-task 分支", () => {
    const src = clientSource();
    expect(src).toContain('action === "lever-to-task"');
    expect(src).toContain("/api/loop-lever-to-task");
  });
});