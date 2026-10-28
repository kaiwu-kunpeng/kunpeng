import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";
import { renderWorkbenchPanel } from "../../src/server/ui/workbench-panel.js";

describe("会话导出按钮", () => {
  test("clientScript 语法有效(防 SPA 崩)", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });
  test("含导出按钮 + 调 ?format=md + 触发下载", () => {
    expect(clientScript).toContain("kp-conv-exp");
    expect(clientScript).toContain("format=md");
    expect(clientScript).toContain("URL.createObjectURL");
    expect(clientScript).toContain(".download");
  });
  test("面板含 kp-conv-exp 样式且保留会话列表容器", () => {
    const html = renderWorkbenchPanel("");
    expect(html).toContain(".kp-conv-exp");
    expect(html).toContain('id="kp-conv-list"');
  });
});