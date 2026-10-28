import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";

describe("多开窗口焦点高亮(作者验收)", () => {
  test("SPA 语法守卫", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });
  test("焦点钩子 + 类名标记在", () => {
    expect(clientScript).toContain("kp-win-active");
    expect(clientScript).toContain("focusin");
  });
});