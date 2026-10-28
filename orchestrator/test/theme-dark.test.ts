import { expect, test } from "vitest";
import { themeCss } from "../src/server/ui/theme.js";

test("themeCss 含 dark 覆盖块、渊蓝黑底、品牌橙保留、light :root 仍在", () => {
  expect(themeCss).toContain('html[data-theme="dark"]');
  expect(themeCss).toContain("#0B1220");      // 渊蓝黑背景
  expect(themeCss).toContain("#E6EDF6");      // 雾蓝白字
  expect(themeCss).toContain(":root");        // light 没被删
  expect(themeCss).toContain("--bg:#FFF8F2"); // 暖纸背景仍在
});
