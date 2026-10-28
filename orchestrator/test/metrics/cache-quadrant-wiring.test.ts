import { describe, it, expect } from "vitest";
import { parseClaudeStreamLine } from "../../src/agent/cli-stream-parse.js";
import { quadrantsFromUsage, costUsd } from "../../src/metrics/cache-cost.js";

describe("A2 cache 四象限埋点", () => {
  it("parseClaudeStreamLine 从 result 行解析 cache_creation/cache_read", () => {
    const line = JSON.stringify({
      type: "result",
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 2000,
        cache_read_input_tokens: 8000,
      },
      modelUsage: { "claude-opus-4-8": {} },
      result: "done",
    });
    const d = parseClaudeStreamLine(line);
    expect(d?.usage?.input).toBe(100);
    expect(d?.usage?.output).toBe(50);
    expect(d?.usage?.cacheCreate).toBe(2000);
    expect(d?.usage?.cacheRead).toBe(8000);
  });

  it("result 行无 cache 字段时 cache 分项为 undefined，不影响 input/output", () => {
    const line = JSON.stringify({
      type: "result",
      usage: { input_tokens: 10, output_tokens: 5 },
      modelUsage: { "claude-opus-4-8": {} },
    });
    const d = parseClaudeStreamLine(line);
    expect(d?.usage?.input).toBe(10);
    expect(d?.usage?.output).toBe(5);
    expect(d?.usage?.cacheCreate).toBeUndefined();
    expect(d?.usage?.cacheRead).toBeUndefined();
  });

  it("quadrantsFromUsage 映射四象限，costUsd 端到端算分项成本", () => {
    const q = quadrantsFromUsage({ input: 100, output: 50, cacheCreate: 2000, cacheRead: 8000 });
    expect(q).toEqual({ freshInput: 100, cacheCreate: 2000, cacheRead: 8000, output: 50 });
    const c = costUsd(q, { input: 15, cacheWrite: 18.75, cacheRead: 1.5, output: 75 });
    expect(c.byQuadrant.cacheRead).toBeCloseTo((8000 / 1_000_000) * 1.5, 12);
    expect(c.byQuadrant.cacheCreate).toBeCloseTo((2000 / 1_000_000) * 18.75, 12);
    expect(c.total).toBeCloseTo(
      (100 / 1e6) * 15 + (2000 / 1e6) * 18.75 + (8000 / 1e6) * 1.5 + (50 / 1e6) * 75,
      12,
    );
  });

  it("quadrantsFromUsage 缺字段默认 0", () => {
    expect(quadrantsFromUsage({})).toEqual({ freshInput: 0, cacheCreate: 0, cacheRead: 0, output: 0 });
    expect(quadrantsFromUsage({ input: 7 })).toEqual({ freshInput: 7, cacheCreate: 0, cacheRead: 0, output: 0 });
  });
});