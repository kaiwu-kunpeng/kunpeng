import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gateLoopWaveByBudget, opsSpentTokensThisMonth, resolveOpsBudget } from "./ops-budget.js";

function tmpState(): string {
  return mkdtempSync(join(tmpdir(), "kp-opsbudget-"));
}

const NOW = Date.UTC(2026, 6, 15); // 2026-07-15

function writeFlow(dir: string, name: string, flow: Record<string, unknown>): void {
  writeFileSync(join(dir, name), JSON.stringify(flow), "utf8");
}

describe("ops budget", () => {
  it("resolveOpsBudget 只认有限正数", () => {
    expect(resolveOpsBudget({ KUNPENG_OPS_TOKEN_BUDGET: "1000" }).maxTokens).toBe(1000);
    expect(resolveOpsBudget({ KUNPENG_OPS_TOKEN_BUDGET: "abc" }).maxTokens).toBeUndefined();
    expect(resolveOpsBudget({ KUNPENG_OPS_TOKEN_BUDGET: "-5" }).maxTokens).toBeUndefined();
    expect(resolveOpsBudget({}).maxTokens).toBeUndefined();
  });

  it("opsSpentTokensThisMonth 只计本月 loop- 前缀流,坏文件跳过", () => {
    const dir = tmpState();
    writeFlow(dir, "a.json", { flowId: "loop-geo-w1", updatedAt: NOW - 1000, tokensUsed: 300 });
    writeFlow(dir, "b.json", { flowId: "loop-geo-w2", updatedAt: NOW - 2000, tokensUsed: 200 });
    writeFlow(dir, "c.json", { flowId: "dev-flow-x", updatedAt: NOW - 1000, tokensUsed: 999 });
    writeFlow(dir, "d.json", { flowId: "loop-old-w9", updatedAt: Date.UTC(2026, 4, 1), tokensUsed: 888 });
    writeFileSync(join(dir, "broken.json"), "{not json", "utf8");
    expect(opsSpentTokensThisMonth(dir, NOW)).toBe(500);
  });

  it("目录不存在返回 0", () => {
    expect(opsSpentTokensThisMonth(join(tmpdir(), "kp-nonexistent-xyz"), NOW)).toBe(0);
  });

  it("gateLoopWaveByBudget:超限 halt,未超不 halt,无预算永不 halt", () => {
    const dir = tmpState();
    writeFlow(dir, "a.json", { flowId: "loop-geo-w1", updatedAt: NOW - 1000, tokensUsed: 1500 });
    const over = gateLoopWaveByBudget(dir, { KUNPENG_OPS_TOKEN_BUDGET: "1000" }, NOW);
    expect(over.halt).toBe(true);
    expect(over.reason).toBe("tokens");
    const under = gateLoopWaveByBudget(dir, { KUNPENG_OPS_TOKEN_BUDGET: "9999" }, NOW);
    expect(under.halt).toBe(false);
    const unlimited = gateLoopWaveByBudget(dir, {}, NOW);
    expect(unlimited.halt).toBe(false);
  });
});