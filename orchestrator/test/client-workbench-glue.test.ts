import { expect, test } from "vitest";

import { clientScript } from "../src/server/ui/client.js";

test("clientScript 含 workbench SSE/对话/gate 与主题接线", () => {
  expect(clientScript).toContain("/api/workspace/");
  expect(clientScript).toContain("/events?msg=");
  expect(clientScript).toContain("/gate");
  // 多窗口架构:输入/发送/流容器由 client.ts 动态创建的窗口承载(kp-win-*),旧的 kp-say-* 单面板 id 已废弃。
  expect(clientScript).toContain("kp-win-send");
  expect(clientScript).toContain("kp-win-log");
  expect(clientScript).toContain("data-theme-set");
  expect(clientScript).toContain("kpTheme");
});
