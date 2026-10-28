import { describe, expect, test } from "vitest";
import { formatChatUsageLine } from "./chat-usage.js";

describe("formatChatUsageLine", () => {
  test("opus full usage, 4dp usd", () => {
    // opus 四向价 in $5 / out $25:1000/1e6*5 + 2000/1e6*25 = 0.005 + 0.05 = 0.055
    expect(formatChatUsageLine({ input: 1000, output: 2000, model: "claude-opus-4-8" }))
      .toBe("in 1000 / out 2000 · claude-opus-4-8 · $0.0550");
  });

  test("fallback model, missing input treated as 0", () => {
    // codex = gpt-5.5,out $30/Mtok: 1000/1e6*30 = 0.03
    expect(formatChatUsageLine({ output: 1000 }, "codex"))
      .toBe("in 0 / out 1000 · codex · $0.0300");
  });

  test("no model anywhere → unknown; zero tokens → $0.0000", () => {
    expect(formatChatUsageLine({})).toBe("in 0 / out 0 · unknown · $0.0000");
  });

  test("negative/NaN tokens clamped to 0", () => {
    expect(formatChatUsageLine({ input: -5, output: Number.NaN, model: "codex" }))
      .toBe("in 0 / out 0 · codex · $0.0000");
  });
});