import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";
import { renderWorkbenchPanel } from "../../src/server/ui/workbench-panel.js";

describe("跳到最新", () => {
  test("clientScript 语法有效(防 SPA 崩)", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });
  test("含跳到最新按钮 + 滚动监听 + 点击滚到底", () => {
    expect(clientScript).toContain("kp-jump");
    expect(clientScript).toContain('"scroll"');
    expect(clientScript).toContain("scrollHeight");
  });
  test("面板含 kp-jump 样式且保留会话列表容器", () => {
    const html = renderWorkbenchPanel("");
    expect(html).toContain(".kp-jump");
    expect(html).toContain('id="kp-conv-list"');
  });
});