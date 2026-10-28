import { describe, expect, test } from "vitest";
import { chatFallbackModel } from "../../src/server/chat-model-fallback.js";

describe("额度降级链：Sonnet 5.5（作者锁定）", () => {
  test("Sonnet 5.5 额度用尽降到 Sonnet 5", () => {
    expect(chatFallbackModel("claude-sonnet-5-5")).toBe("claude-sonnet-5");
  });
  test("既有降级映射保持不变", () => {
    expect(chatFallbackModel("claude-fable-5-1")).toBe("claude-opus-5");
    expect(chatFallbackModel("claude-opus-5-5")).toBe("claude-sonnet-5");
    expect(chatFallbackModel("claude-opus-5")).toBe("claude-sonnet-5");
    expect(chatFallbackModel("claude-sonnet-5")).toBe("claude-sonnet-4-6");
    expect(chatFallbackModel("claude-sonnet-4-6")).toBeUndefined();
    expect(chatFallbackModel("codex")).toBeUndefined();
  });
});