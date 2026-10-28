import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";

describe("U3 合并门二次确认 + 查看改动(作者验收)", () => {
  test("SPA 语法守卫", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });

  test("两次确认 + 查看改动 三处标记都在", () => {
    expect(clientScript).toContain("data-gate-confirm");
    expect(clientScript).toContain("data-gate-diff");
    expect(clientScript).toContain("/api/gate-diff");
  });
});