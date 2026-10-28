import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";

describe("会话内搜索(作者验收)", () => {
  test("SPA 语法守卫", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });
  test("搜索条 + 命中标记 + Cmd/Ctrl+F 触发", () => {
    expect(clientScript).toContain("kp-win-search");
    expect(clientScript).toContain("kp-search-hit");
    expect(clientScript).toContain("preventDefault");
  });
});