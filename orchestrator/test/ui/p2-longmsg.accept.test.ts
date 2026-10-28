import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";

describe("P2 长消息走 body(作者验收)", () => {
  test("SPA 语法守卫", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });

  test("正文放进 requestBody,不再拼进 /chat URL", () => {
    expect(clientScript).toContain("requestBody.msg = text");
    // chat 发送的 URL 不再包含 &msg= 拼接
    const fence = "/chat?";
    const idx = clientScript.indexOf(fence);
    expect(idx).toBeGreaterThan(-1);
    const around = clientScript.slice(idx, idx + 400);
    expect(around.includes('"&msg=" + encodeURIComponent(text)')).toBe(false);
  });
});