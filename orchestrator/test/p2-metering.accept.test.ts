import { describe, expect, it } from "vitest";
import { parseCodexStreamLine } from "../src/agent/cli-stream-parse.js";
import { formatChatUsageLine, sumConversationUsd } from "../src/server/chat-usage.js";

describe("P2 计量修正(作者验收)", () => {
  it("codex turn.completed 现在带 input 与 cache", () => {
    const r = parseCodexStreamLine(JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5000, cache_creation_input_tokens: 40 },
    }));
    expect(r?.usage?.input).toBe(100);
    expect(r?.usage?.output).toBe(20);
    expect(r?.usage?.cacheRead).toBe(5000);
    expect(r?.usage?.cacheCreate).toBe(40);
  });

  it("usage 行:无 cache 不显示 cache,有 cache 显示且成本更高", () => {
    const noCache = formatChatUsageLine({ input: 1000, output: 1000, model: "claude-opus-4-8" });
    expect(noCache.includes("cache")).toBe(false);
    const withCache = formatChatUsageLine({ input: 1000, output: 1000, cacheRead: 500000, model: "claude-opus-4-8" });
    expect(withCache.includes("cache")).toBe(true);
    const usd = (s: string) => Number((s.match(/\$([0-9.]+)/) || [])[1]);
    expect(usd(withCache)).toBeGreaterThan(usd(noCache));
  });

  it("sumConversationUsd 计入 cacheRead(比忽略 cache 更高)", () => {
    const withCache = sumConversationUsd([{ usage: { input: 100, output: 100, cacheRead: 1_000_000, model: "claude-opus-4-8" } }]);
    const withoutCache = sumConversationUsd([{ usage: { input: 100, output: 100, model: "claude-opus-4-8" } }]);
    expect(withCache).toBeGreaterThan(withoutCache);
  });
});
