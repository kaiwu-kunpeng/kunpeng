import { describe, expect, test } from "vitest";

import { renderWorkbenchPanel } from "./workbench-panel.js";

// 锁定:工作台从「顶部工具栏」重构为「左侧常驻栏 + 右侧主区」双栏(类 Claude/ChatGPT)。
// 本段只产出布局骨架(空的会话列表容器);列表填充/续聊/软删/改名由 client.ts(段五-2,e2e)负责。
describe("renderWorkbenchPanel 左栏布局", () => {
  const html = renderWorkbenchPanel("<p>SUMMARY-MARKER</p>");

  test("左侧常驻栏存在(kp-wb-side)且含会话列表容器 id=kp-conv-list", () => {
    expect(html).toContain("kp-wb-side");
    expect(html).toContain('id="kp-conv-list"');
  });

  test("＋新对话按钮(id=kp-new-chat)保留", () => {
    expect(html).toContain('id="kp-new-chat"');
  });

  test("右侧主区保留窗口网格 id=kp-windows", () => {
    expect(html).toContain('id="kp-windows"');
  });

  test("旧顶部历史下拉不存在(kp-history / kp-hist-menu)", () => {
    expect(html).not.toContain('id="kp-history"');
    expect(html).not.toContain('id="kp-hist-menu"');
  });

  test("summaryHtml 仍被嵌入折叠区", () => {
    expect(html).toContain("SUMMARY-MARKER");
    expect(html).toContain("kp-old-summary");
  });
});
