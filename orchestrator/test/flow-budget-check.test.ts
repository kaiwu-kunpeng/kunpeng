import { describe, expect, it } from "vitest";
import { checkFlowBudget, resolveFlowBudget } from "../src/runtime/flow-budget.js";

describe("per-flow 预算硬闸", () => {
  it("token 超 100% → halt,reason 含 budget-exceeded 与越界维", () => {
    const v = checkFlowBudget({ tokens: 105000, elapsedMs: 0 }, { maxTokens: 100000 });
    expect(v.level).toBe("halt");
    expect(v.reason).toContain("budget-exceeded");
    expect(v.reason).toContain("tokens");
  });

  it("80% 档触发 warn80", () => {
    const v = checkFlowBudget({ tokens: 85000, elapsedMs: 0 }, { maxTokens: 100000 });
    expect(v.level).toBe("warn80");
  });

  it("50% 档触发 warn50", () => {
    const v = checkFlowBudget({ tokens: 60000, elapsedMs: 0 }, { maxTokens: 100000 });
    expect(v.level).toBe("warn50");
  });

  it("未配任何预算 → 恒 ok", () => {
    expect(checkFlowBudget({ tokens: 9_999_999, elapsedMs: 9_999_999 }, {}).level).toBe("ok");
  });

  it("多维取最高档:时长 warn50 而 token halt → halt", () => {
    const v = checkFlowBudget({ tokens: 105000, elapsedMs: 60000 }, { maxTokens: 100000, maxMs: 120000 });
    expect(v.level).toBe("halt");
  });

  it("resolveFlowBudget 忽略非数字环境变量", () => {
    const b = resolveFlowBudget({ KUNPENG_FLOW_TOKEN_BUDGET: "abc", KUNPENG_FLOW_MS_BUDGET: "120000" });
    expect(b.maxTokens).toBeUndefined();
    expect(b.maxMs).toBe(120000);
  });
});
