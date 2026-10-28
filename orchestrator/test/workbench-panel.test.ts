import { expect, test } from "vitest";
import { renderWorkbenchPanel } from "../src/server/ui/workbench-panel.js";

test("面板是多窗口外壳:左栏会话列表 + 右侧窗口容器,旧摘要进折叠区不丢", () => {
  const html = renderWorkbenchPanel('<div class="run">旧摘要标记XYZ</div>');
  // 多窗口架构:输入框/发送/流容器(kp-win-*)由 client.ts 在 #kp-windows 里动态创建,不再是面板静态 HTML。
  // 面板只是外壳:左侧常驻会话列表容器 + 右侧窗口网格 + 新对话入口。
  expect(html).toContain('id="kp-conv-list"');
  expect(html).toContain('id="kp-windows"');
  expect(html).toContain('id="kp-new-chat"');
  // 旧摘要降级进折叠区且内容不丢。
  expect(html).toContain("kp-old-summary");
  expect(html).toContain("旧摘要标记XYZ");
});
