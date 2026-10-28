// 验收锚:计费 token 只有一个定义,flow 与 chat 共用;claude 不再漏算 cache。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { effectiveBilledTokens } from "../../src/runtime/billed-tokens.js";
import { parseBackendOutput } from "../../src/agent/cli-runner.js";

describe("effectiveBilledTokens 单一口径", () => {
  it("无 cache 字段时 = input + output(向后兼容)", () => {
    expect(effectiveBilledTokens({ input: 100, output: 20 })).toBe(120);
  });

  it("cache_create 按 1.25、cache_read 按 0.1 计权", () => {
    expect(effectiveBilledTokens({ input: 0, output: 0, cacheCreate: 100 })).toBe(125);
    expect(effectiveBilledTokens({ input: 0, output: 0, cacheRead: 1000 })).toBe(100);
    expect(effectiveBilledTokens({ input: 10, output: 5, cacheCreate: 40, cacheRead: 200 })).toBe(85);
  });

  it("缺字段当 0,全空为 0", () => {
    expect(effectiveBilledTokens({})).toBe(0);
    expect(effectiveBilledTokens({ output: 7 })).toBe(7);
  });

  it("非有限数不得污染结果", () => {
    expect(effectiveBilledTokens({ input: Number.NaN, output: 5 })).toBe(5);
    expect(effectiveBilledTokens({ input: Number.POSITIVE_INFINITY, output: 5 })).toBe(5);
    expect(Number.isFinite(effectiveBilledTokens({ cacheRead: Number.NaN }))).toBe(true);
  });

  it("结果为整数且非负", () => {
    const v = effectiveBilledTokens({ input: 3, output: 3, cacheCreate: 7, cacheRead: 33 });
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe("claude 流不再漏算 cache", () => {
  it("parseBackendOutput 把 cache_creation/cache_read 计入 token", () => {
    const parsed = parseBackendOutput(
      "claude",
      JSON.stringify({
        result: "hi",
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_creation_input_tokens: 400,
          cache_read_input_tokens: 5000,
        },
      }),
      "",
    );
    // 120 + 400×1.25 + 5000×0.1 = 1120
    expect(parsed.tokens).toBe(1120);
    expect(parsed.text).toBe("hi");
  });

  it("旧形态(无 cache 字段)结果不变,保住既有断言", () => {
    const parsed = parseBackendOutput(
      "claude",
      JSON.stringify({ result: "hi", usage: { input_tokens: 100, output_tokens: 20 } }),
      "",
    );
    expect(parsed).toEqual({ text: "hi", tokens: 120 });
  });

  it("codex 分支未被波及", () => {
    const parsed = parseBackendOutput("codex", "out tokens used 9", "err");
    expect(parsed.text).toBe("out tokens used 9err");
    expect(parsed.tokens).toBe(9);
  });
});

describe("口径确实只剩一处定义", () => {
  it("chat-usage 不再自带私有实现,改为 import", () => {
    const p = fileURLToPath(new URL("../../src/server/chat-usage.ts", import.meta.url));
    const text = readFileSync(p, "utf8");
    expect(text.includes("function effectiveBilledTokens")).toBe(false);
    expect(text.includes("billed-tokens.js")).toBe(true);
  });

  it("cli-runner 的 claude 分支已接上统一口径", () => {
    const p = fileURLToPath(new URL("../../src/agent/cli-runner.ts", import.meta.url));
    const text = readFileSync(p, "utf8");
    expect(text.includes("effectiveBilledTokens")).toBe(true);
    expect(text.includes("cache_read_input_tokens")).toBe(true);
  });
});