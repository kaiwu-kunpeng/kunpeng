import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isBudgetBlocker, makeBudgetCheck, maxBudgetLevel } from "../../src/runtime/budget-guard.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";

let repo: string;
let tracker: FlowTracker;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kp-budget-guard-"));
  tracker = new FlowTracker(join(repo, ".kunpeng", "state"), () => 1_700_000_000_000);
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

async function realFlow(id: string): Promise<void> {
  await tracker.start(id, "req");
  await tracker.setStageModel(id, "spec", "claude-opus-5");
  await tracker.setStageModel(id, "implement", "gpt-6-astra@xhigh");
  await tracker.addStageTokens(id, "spec", 13770);
  await tracker.addStageTokens(id, "implement", 100255);
  await tracker.addTokens(id, 114025);
}

describe("预算守卫（作者锁定）", () => {
  it("等级比较与 blocker 识别", () => {
    expect(maxBudgetLevel("ok", "warn50")).toBe("warn50");
    expect(maxBudgetLevel("warn80", "warn50")).toBe("warn80");
    expect(maxBudgetLevel("halt", "warn80")).toBe("halt");
    expect(isBudgetBlocker("budget-exceeded: usd 107%")).toBe(true);
    expect(isBudgetBlocker("卡在 verify")).toBe(false);
    expect(isBudgetBlocker(undefined)).toBe(false);
  });

  it("单流超预算 → halt、写 budget 记录、写 pause 标记；预警只记录不写标记", async () => {
    await realFlow("f1");
    const halt = await makeBudgetCheck({ repoRoot: repo, tracker, env: { KUNPENG_FLOW_USD_BUDGET: "3" }, now: () => 1_700_000_100_000 })({ flowId: "f1", stage: "implement" });
    expect(halt.level).toBe("halt");
    expect(halt.scope).toBe("flow");
    expect(halt.spentUsd).toBeCloseTo(3.2142, 3);
    expect(halt.spentTokens).toBe(114025);
    expect(existsSync(join(repo, ".kunpeng", "pause", "f1"))).toBe(true);
    const s = (await tracker.read("f1"))!;
    expect(s.budget).toMatchObject({ level: "halt", scope: "flow", spentTokens: 114025 });
    expect(s.budget?.reason).toContain("budget-exceeded");

    await realFlow("f2");
    const warn = await makeBudgetCheck({ repoRoot: repo, tracker, env: { KUNPENG_FLOW_USD_BUDGET: "4" } })({ flowId: "f2", stage: "implement" });
    expect(warn.level).toBe("warn80");
    expect(existsSync(join(repo, ".kunpeng", "pause", "f2"))).toBe(false);
    expect((await tracker.read("f2"))!.budget?.level).toBe("warn80");

    const ok = await makeBudgetCheck({ repoRoot: repo, tracker, env: { KUNPENG_FLOW_USD_BUDGET: "off" } })({ flowId: "f2", stage: "repair" });
    expect(ok.level).toBe("ok");
  });

  it("续跑基线：以基线时刻的用量为 0 起算", async () => {
    await realFlow("f3");
    const check = makeBudgetCheck({ repoRoot: repo, tracker, env: { KUNPENG_FLOW_USD_BUDGET: "3" }, baselineFlowId: "f3" });
    const first = await check({ flowId: "f3", stage: "implement" });
    expect(first.level).toBe("ok");
    expect(first.spentUsd).toBeCloseTo(0, 3);
    await tracker.addStageTokens("f3", "implement", 100255);
    const second = await check({ flowId: "f3", stage: "repair" });
    expect(second.spentUsd).toBeCloseTo(3.0077, 3);
    expect(second.level).toBe("halt");
  });

  it("仓库日预算：两条流合计超 budget.json 的 dailyUsd → halt，scope=repo", async () => {
    mkdirSync(join(repo, ".kunpeng"), { recursive: true });
    writeFileSync(join(repo, ".kunpeng", "budget.json"), JSON.stringify({ dailyUsd: 5 }), "utf8");
    await realFlow("r1");
    await realFlow("r2");
    const v = await makeBudgetCheck({ repoRoot: repo, tracker, env: { KUNPENG_FLOW_USD_BUDGET: "off" }, now: () => 1_700_000_000_500 })({ flowId: "r2", stage: "implement" });
    expect(v.level).toBe("halt");
    expect(v.scope).toBe("repo");
    expect(v.reason).toContain("day-usd");
    expect(existsSync(join(repo, ".kunpeng", "pause", "r2"))).toBe(true);
  });

  it("未知流 → ok，不写任何东西", async () => {
    const v = await makeBudgetCheck({ repoRoot: repo, tracker, env: {} })({ flowId: "nope", stage: "implement" });
    expect(v.level).toBe("ok");
    expect(existsSync(join(repo, ".kunpeng", "pause"))).toBe(false);
  });
});