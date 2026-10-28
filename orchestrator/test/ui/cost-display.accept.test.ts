// @vitest-environment happy-dom
import { beforeEach, describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";

type CostCalculator = (model: string, tokens: number) => number;
type CostWindow = typeof globalThis.window & { kpCostUsd: CostCalculator };

function md(): CostCalculator {
  document.documentElement.innerHTML = "<head></head><body><div id=\"view\"></div></body>";
  new Function(clientScript)();
  return (globalThis.window as CostWindow).kpCostUsd;
}

describe("对话成本常显(作者验收)", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "<head></head><body><div id=\"view\"></div></body>";
  });

  test("SPA 语法守卫 + KP_PRICING 注入", () => {
    expect(() => new Function(clientScript)).not.toThrow();
    expect(clientScript).toContain("KP_PRICING");
  });

  test("kpCostUsd 按模型费率算,未知用 default", () => {
    const f = md();
    expect(typeof f).toBe("function");
    expect(f("claude-opus-4-8", 1_000_000)).toBeCloseTo(15, 1);
    expect(f("totally-unknown-model", 1_000_000)).toBeCloseTo(3, 1);
    expect(f("claude-opus-4-8", 0)).toBe(0);
  });
});
