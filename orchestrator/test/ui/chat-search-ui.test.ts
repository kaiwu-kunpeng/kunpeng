import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";
import { renderWorkbenchPanel } from "../../src/server/ui/workbench-panel.js";

describe("会话搜索框前端", () => {
  test("clientScript 语法有效(防 SPA 崩)", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });

  test("client 含搜索函数与端点调用", () => {
    expect(clientScript).toContain("function searchConversations");
    expect(clientScript).toContain("/api/conversations?q=");
    expect(clientScript).toContain("kp-conv-search");
  });

  test("workbench-panel 含搜索框且保留会话列表容器", () => {
    const html = renderWorkbenchPanel("");
    expect(html).toContain('id="kp-conv-search"');
    expect(html).toContain('id="kp-conv-list"');
  });
});