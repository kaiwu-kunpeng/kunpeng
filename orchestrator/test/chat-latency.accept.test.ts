import { describe, expect, it } from "vitest";
import { formatChatUsageLine } from "../src/server/chat-usage.js";

describe("响应耗时入行(作者验收)", () => {
  it("timing 拼接与省略", () => {
    const full = formatChatUsageLine({ input: 10, output: 5, model: "claude-opus-4-8" }, undefined, undefined, { firstTokenMs: 2300, totalMs: 8100 });
    expect(full).toContain("首字 2.3s");
    expect(full).toContain("总 8.1s");
    const onlyTotal = formatChatUsageLine({ input: 10, output: 5, model: "claude-opus-4-8" }, undefined, undefined, { totalMs: 900 });
    expect(onlyTotal).toContain("总 0.9s");
    expect(onlyTotal).not.toContain("首字");
    const none = formatChatUsageLine({ input: 10, output: 5, model: "claude-opus-4-8" });
    expect(none).not.toContain("首字");
  });
});