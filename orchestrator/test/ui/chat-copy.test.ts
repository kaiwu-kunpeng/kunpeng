import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";
import { renderWorkbenchPanel } from "../../src/server/ui/workbench-panel.js";

describe("助手消息复制按钮", () => {
  test("clientScript 语法有效(防 SPA 崩)", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });
  test("助手消息带 data-copy 与复制按钮 + 委托复制", () => {
    expect(clientScript).toContain("kp-msg");
    expect(clientScript).toContain("data-copy");
    expect(clientScript).toContain('class="kp-copy"');
    expect(clientScript).toContain("navigator.clipboard");
  });
  test("面板含 kp-copy 样式且不破坏会话列表容器", () => {
    const html = renderWorkbenchPanel("");
    expect(html).toContain(".kp-copy");
    expect(html).toContain('id="kp-conv-list"');
  });
});