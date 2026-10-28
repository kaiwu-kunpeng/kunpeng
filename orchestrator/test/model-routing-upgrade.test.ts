import { describe, expect, test } from "vitest";
import { CLAUDE_TIER, routeForStage, scheduledRoute } from "../src/agent/model-routing.js";
import type { Stage } from "../src/agent/runner.js";
import { rateCardForModel } from "../src/runtime/cost-pricing.js";

const STAGES: Stage[] = ["spec", "design", "implement", "review", "verify", "audit"];

describe("2026-09-07 模型路由升级(作者锁定)", () => {
  test("claude 全阶段 → claude-opus-5,不再有 opus-4-8", () => {
    for (const stage of STAGES) {
      expect(routeForStage(stage, "claude").model, stage).toBe("claude-opus-5");
      expect(CLAUDE_TIER[stage].model).not.toContain("4-8");
    }
  });
  test("codex 写代码 → gpt-6-astra xhigh;修复重试复用 implement 路线", () => {
    const impl = scheduledRoute("implement", "codex", {});
    expect(impl).toEqual({ model: "gpt-6-astra", effort: "xhigh" });
  });
  test("codex 其余阶段仍是 gpt-5.6 低档分层,未被误改", () => {
    expect(scheduledRoute("spec", "codex", {})).toEqual({ model: "gpt-5.6-luna", effort: "low" });
    expect(scheduledRoute("verify", "codex", {})).toEqual({ model: "gpt-5.6-luna", effort: "low" });
    expect(scheduledRoute("review", "codex", {})).toEqual({ model: "gpt-5.6-terra", effort: "medium" });
    expect(scheduledRoute("audit", "codex", {})).toEqual({ model: "gpt-5.6-terra", effort: "medium" });
  });
  test("KUNPENG_MODEL_ROUTE 仍可把写代码降回 gpt-5.6-sol(成本逃生阀)", () => {
    const env = { KUNPENG_MODEL_ROUTE: JSON.stringify({ implement: { model: "gpt-5.6-sol" } }) };
    expect(scheduledRoute("implement", "codex", env)).toEqual({ model: "gpt-5.6-sol", effort: "xhigh" });
  });
  test("新默认模型在价目表里有专属条目(不落兜底价)", () => {
    expect(rateCardForModel("gpt-6-astra").output).toBe(50);
    expect(rateCardForModel("claude-opus-5").output).toBe(25);
  });
});