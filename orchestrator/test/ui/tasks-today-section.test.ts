import { describe, it, expect } from "vitest";
import { renderTasks } from "../../src/server/ui/views/tasks.js";
import { clientScript } from "../../src/server/ui/client.js";

describe("任务台「今日」面板骨架", () => {
  const html = renderTasks([]);
  it("有今日容器与刷新按钮", () => {
    expect(html).toContain("data-today-summary");
    expect(html).toContain('data-action="today-refresh"');
  });
  it("有创建任务表单与全部字段", () => {
    expect(html).toContain("data-task-create");
    for (const name of ["title", "goal", "acceptance", "type"]) {
      expect(html).toContain(`name="${name}"`);
    }
  });
  it("既有任务板仍在（不是替换而是叠加）", () => {
    expect(html).toContain("task-board");
  });
  it("无内联硬编码颜色（样式走既有 class/var）", () => {
    expect(/style="[^"]*#[0-9a-fA-F]{3,8}/.test(html)).toBe(false);
  });
});

describe("client 端接线（字符串级断言，真浏览器行为另行冒烟）", () => {
  it("clientScript 含今日拉取与任务创建接线", () => {
    expect(clientScript).toContain("loadTodaySection");
    expect(clientScript).toContain("/api/today?projectId=");
    expect(clientScript).toContain("data-task-create");
    expect(clientScript).toContain("acceptanceCriteria");
  });
  it("#/tasks 路由进入时触发今日加载", () => {
    expect(clientScript.includes('"#/tasks"')).toBe(true);
  });
});