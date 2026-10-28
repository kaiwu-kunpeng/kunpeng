import { expect, test } from "vitest";
import { part03 } from "../../src/server/ui/client-parts/part03.js";

test("快捷条常驻在 composer 里,而不是只在空态渲染", () => {
  const bar = part03.indexOf('class="kp-quick-bar"');
  const composer = part03.indexOf('<div class="kp-composer">');
  const cbox = part03.indexOf('<div class="kp-cbox">');
  expect(composer).toBeGreaterThan(-1);
  expect(cbox).toBeGreaterThan(-1);
  expect(bar).toBeGreaterThan(composer);
  expect(bar).toBeLessThan(cbox);
});

// 六条提示词的逐字内容与点击行为由 chat-quick-actions-relay.test.ts 断言,这里只锁三类契约的形状。
test("快捷条分三类契约:1 个纯动作 + 2 个需目录 + 3 个纯填词", () => {
  expect(part03.split('data-kp-quick-authorize="1"').length - 1, "只有授权按钮是纯动作").toBe(1);
  expect(part03.split('data-kp-needs-dir="1"').length - 1, "读文件夹 / 生成文档两条依赖目录").toBe(2);
  expect(part03.split('data-kp-example="').length - 1, "六个按钮里五个带提示词(授权按钮不带)").toBe(5);
});

test("空态里重复的示例卡块已删干净", () => {
  expect(part03).not.toContain("kp-examples");
  expect(part03).toContain("chatEmptyStateHtml");
  expect(part03).toContain("直接打字对话");
});

test("快捷条自己横向滚动,不让页面横向滚动", () => {
  const rule = part03.slice(part03.indexOf(".kp-quick-bar"), part03.indexOf(".kp-quick-bar") + 220);
  expect(rule).toContain("overflow-x:auto");
});