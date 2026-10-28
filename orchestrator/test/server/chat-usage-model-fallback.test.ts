import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { formatChatUsageLine, sumConversationUsd, usageWithModel } from "../../src/server/chat-usage.js";

// 2026-09-07 线上实测:codex 一轮 in 26595 / out 27 / cache 读 4480,usage 行 $0.1360,
// 但"会话累计"只有 $0.0272——codex 的 usage 不带 model,sumConversationUsd 按 unknown 兜底价算了。
const CODEX_TURN = { input: 26595, output: 27, cacheRead: 4480 };

describe("chat usage 缺 model 时用本轮对话模型补齐(作者锁定)", () => {
  test("usageWithModel:缺省补 fallback,显式 model 优先,空白归 unknown,其它字段原样", () => {
    expect(usageWithModel({ input: 1, output: 2 }, "codex")).toEqual({ input: 1, output: 2, model: "codex" });
    expect(usageWithModel({ input: 1, model: "claude-opus-5" }, "codex").model).toBe("claude-opus-5");
    expect(usageWithModel({ input: 1, model: "  " }, " gpt-6-astra ").model).toBe("gpt-6-astra");
    expect(usageWithModel({ output: 3 }, "").model).toBe("unknown");
    expect(usageWithModel({ ...CODEX_TURN, cacheCreate: 7 }, "codex")).toEqual({ ...CODEX_TURN, cacheCreate: 7, model: "codex" });
  });

  test("补齐 model 后,会话累计与 usage 行同价(codex = gpt-5.5 四向价 $0.136025)", () => {
    const turn = usageWithModel(CODEX_TURN, "codex");
    const session = sumConversationUsd([{ usage: turn }]);
    expect(session).toBeCloseTo(0.136025, 9);
    expect(formatChatUsageLine(CODEX_TURN, "codex")).toContain(`$${session.toFixed(4)}`);
    // 未补齐时按 unknown 兜底价,只有 0.0272:锁死不回退
    expect(sumConversationUsd([{ usage: CODEX_TURN }])).toBeCloseTo(0.027178, 9);
  });

  test("chat-stream 构造 lastUsage 时经过 usageWithModel(源码锚点)", () => {
    const src = readFileSync(new URL("../../src/server/chat-stream.ts", import.meta.url), "utf8");
    expect(src).toContain("usageWithModel({ input: d.usage.input, output: d.usage.output, model: d.usage.model }, model)");
    expect(src).not.toContain("lastUsage = { input: d.usage.input, output: d.usage.output, model: d.usage.model };");
  });
});