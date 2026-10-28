import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";

describe("U1 对话即时体验(作者验收)", () => {
  test("SPA 语法守卫", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });

  test("草稿持久化 / 重试 / 空态示例卡 三处标记都在", () => {
    expect(clientScript).toContain("kpDraft:");
    expect(clientScript.includes("__kpLastRun") || clientScript.includes("data-kp-retry")).toBe(true);
    expect(clientScript).toContain("kp-example");
  });
});