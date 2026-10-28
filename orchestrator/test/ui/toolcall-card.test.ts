import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";
import { renderWorkbenchPanel } from "../../src/server/ui/workbench-panel.js";

describe("tool-call 三态卡片", () => {
  test("clientScript 语法有效(防 SPA 崩)", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });
  test("onmessage 含按 toolId 更新卡片逻辑", () => {
    expect(clientScript).toContain("kp-tool-upd");
    expect(clientScript).toContain("data-tool-id");
    expect(clientScript).toContain("kp-tool-ok");
    expect(clientScript).toContain("kp-tool-err");
  });
  test("面板含工具卡三态样式且保留会话列表容器", () => {
    const html = renderWorkbenchPanel("");
    expect(html).toContain(".kp-tool");
    expect(html).toContain(".kp-tool-ok");
    expect(html).toContain(".kp-tool-err");
    expect(html).toContain('id="kp-conv-list"');
  });
});