import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flowUsdStageMix } from "../../src/runtime/flow-cost.js";
import {
  DEFAULT_FLOW_USD_BUDGET,
  checkFlowBudget,
  checkRepoBudget,
  loadRepoBudget,
  repoBudgetPath,
  repoSpentUsd,
  resolveFlowBudget,
} from "../../src/runtime/flow-budget.js";

// 对账样本：真实 verified codex 流 merge-guard-tests-q1-rev2（2026-09-16）
const REAL = {
  tokensUsed: 114025,
  stageTokens: { spec: 13770, implement: 100255 },
  stageModels: { spec: "claude-opus-5", implement: "gpt-6-astra@xhigh" },
  stageBackends: { spec: "claude", implement: "codex" },
  backend: "codex",
};

describe("单流预算：正数语义、缺省 8 美元、阶段混合价对账（作者锁定）", () => {
  it("只接受有限正数；USD 缺省 8；off/0 关闭", () => {
    expect(DEFAULT_FLOW_USD_BUDGET).toBe(8);
    expect(resolveFlowBudget({})).toEqual({ maxUsd: 8 });
    expect(resolveFlowBudget({ KUNPENG_FLOW_USD_BUDGET: "off" })).toEqual({});
    expect(resolveFlowBudget({ KUNPENG_FLOW_USD_BUDGET: "0" })).toEqual({});
    expect(resolveFlowBudget({ KUNPENG_FLOW_USD_BUDGET: "-5" })).toEqual({});
    expect(resolveFlowBudget({ KUNPENG_FLOW_USD_BUDGET: "12.5", KUNPENG_FLOW_TOKEN_BUDGET: "0", KUNPENG_FLOW_MS_BUDGET: "60000" })).toEqual({ maxUsd: 12.5, maxMs: 60000 });
    expect(resolveFlowBudget({ KUNPENG_FLOW_TOKEN_BUDGET: "abc", KUNPENG_FLOW_MS_BUDGET: "120000" })).toMatchObject({ maxMs: 120000, maxUsd: 8 });
  });

  it("真实流对账：3.2142 美元 → 缺省 8 美元 ok，4 美元 warn80，3 美元 halt", () => {
    const usd = flowUsdStageMix(REAL);
    expect(usd).toBeCloseTo(3.2142, 3);
    expect(checkFlowBudget({ tokens: REAL.tokensUsed, elapsedMs: 767_296, usd }, resolveFlowBudget({})).level).toBe("ok");
    const warn = checkFlowBudget({ tokens: REAL.tokensUsed, elapsedMs: 767_296, usd }, { maxUsd: 4 });
    expect(warn.level).toBe("warn80");
    expect(warn.ratios.usd).toBeCloseTo(0.8036, 3);
    const halt = checkFlowBudget({ tokens: REAL.tokensUsed, elapsedMs: 767_296, usd }, { maxUsd: 3 });
    expect(halt.level).toBe("halt");
    expect(halt.reason).toContain("budget-exceeded");
    expect(halt.reason).toContain("usd");
  });

  it("没给 usd 时仍走旧的单模型估价路径", () => {
    const v = checkFlowBudget({ tokens: 1_000_000, elapsedMs: 0, model: "default" }, { maxUsd: 1 });
    expect(v.level).toBe("halt");
  });
});

describe("仓库预算（作者锁定）", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-repo-budget-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("budget.json 解析：缺失/坏文件 → 空；只收正数，maxConcurrent 须整数", () => {
    const kp = join(dir, ".kunpeng");
    expect(repoBudgetPath(kp)).toBe(join(kp, "budget.json"));
    expect(loadRepoBudget(kp)).toEqual({});
    mkdirSync(kp, { recursive: true });
    writeFileSync(repoBudgetPath(kp), "{bad", "utf8");
    expect(loadRepoBudget(kp)).toEqual({});
    writeFileSync(repoBudgetPath(kp), JSON.stringify({ dailyUsd: 20, monthlyUsd: -1, maxConcurrent: 2.5, extra: 1 }), "utf8");
    expect(loadRepoBudget(kp)).toEqual({ dailyUsd: 20 });
    writeFileSync(repoBudgetPath(kp), JSON.stringify({ dailyUsd: 20, monthlyUsd: 300, maxConcurrent: 3 }), "utf8");
    expect(loadRepoBudget(kp)).toEqual({ dailyUsd: 20, monthlyUsd: 300, maxConcurrent: 3 });
  });

  it("按 UTC 日/月聚合阶段混合价；缺 updatedAt 不计", () => {
    const now = Date.UTC(2026, 8, 16, 12, 0, 0);
    const flows = [
      { ...REAL, updatedAt: Date.UTC(2026, 8, 16, 1, 0, 0) },
      { ...REAL, updatedAt: Date.UTC(2026, 8, 15, 23, 0, 0) },
      { ...REAL, updatedAt: Date.UTC(2026, 7, 31, 23, 0, 0) },
      { ...REAL },
    ];
    const spent = repoSpentUsd(flows, now);
    expect(spent.dayUsd).toBeCloseTo(3.2142, 3);
    expect(spent.monthUsd).toBeCloseTo(6.4284, 3);
  });

  it("checkRepoBudget 分档与文案同单流", () => {
    expect(checkRepoBudget({ dayUsd: 1, monthUsd: 1 }, {}).level).toBe("ok");
    const warn = checkRepoBudget({ dayUsd: 8.5, monthUsd: 10 }, { dailyUsd: 10, monthlyUsd: 300 });
    expect(warn.level).toBe("warn80");
    expect(warn.reason).toContain("day-usd");
    expect(warn.ratios.dayUsd).toBeCloseTo(0.85, 3);
    const halt = checkRepoBudget({ dayUsd: 1, monthUsd: 301 }, { dailyUsd: 10, monthlyUsd: 300 });
    expect(halt.level).toBe("halt");
    expect(halt.reason).toContain("budget-exceeded");
    expect(halt.reason).toContain("month-usd");
  });
});