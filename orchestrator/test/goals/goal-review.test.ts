import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRequest, AgentResult } from "../../src/agent/runner.js";
import { GoalStore, goalsDir } from "../../src/goals/store.js";
import {
  GoalReviewStore,
  REVIEW_DELTA_SYSTEM,
  REVIEW_PROPOSAL_SYSTEM,
  acceptGoalReview,
  buildGoalReviewFacts,
  parseJsonBlock,
  rejectGoalReview,
  runGoalReview,
} from "../../src/goals/review.js";
import type { FlowState } from "../../src/runtime/flowstate.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-goal-review-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const NOW = Date.UTC(2026, 8, 16, 12, 0, 0);
function flow(id: string, patch: Partial<FlowState>): FlowState {
  return {
    flowId: id, requirement: id, stage: "done", status: "verified", agentActive: false, pid: 1, host: "h",
    startedAt: NOW - 3_600_000, updatedAt: NOW - 3_600_000, history: [],
    stageTokens: { implement: 100255 }, stageModels: { implement: "gpt-6-astra@xhigh" }, tokensUsed: 100255,
    tokenQuad: { input: 80000, output: 20255, cacheCreate: 0, cacheRead: 0 }, changedFileCount: 3,
    ...patch,
  } as FlowState;
}
const FLOWS: FlowState[] = [
  flow("a", { goalId: "goal-seo" }),
  flow("b", { goalId: "goal-seo", status: "rolled-back", changedFileCount: 0 }),
  flow("c", { goalId: "goal-other" }),
  flow("d", { goalId: "goal-seo", updatedAt: NOW - 30 * 86_400_000 }),
  flow("e", {}),
];

class ScriptedRunner {
  calls: AgentRequest[] = [];
  constructor(private outputs: string[]) {}
  async run(req: AgentRequest): Promise<AgentResult> {
    this.calls.push(req);
    return { text: this.outputs[this.calls.length - 1] ?? "", meta: {}, backend: "claude" };
  }
}

async function seedGoal(): Promise<{ goals: GoalStore; reviews: GoalReviewStore }> {
  const kp = join(dir, ".kunpeng");
  const goals = new GoalStore(goalsDir(kp), () => NOW);
  await goals.create({ id: "goal-seo", product: "proj-b", statement: "SEO 内链：收录数 +30%", metric: { key: "indexed", label: "收录数", target: 130, direction: "up", current: 105 } });
  return { goals, reviews: new GoalReviewStore(join(goalsDir(kp), "reviews")) };
}

describe("复盘事实与 JSON 解析（作者锁定）", () => {
  it("只取本目标、本窗口的流；周报文本随附", async () => {
    const { goals } = await seedGoal();
    const facts = buildGoalReviewFacts((await goals.read("goal-seo"))!, FLOWS, { sinceMs: NOW - 7 * 86_400_000, untilMs: NOW });
    expect(facts.flows).toMatchObject({ total: 2, verified: 1, rolledBack: 1, changedFiles: 3 });
    expect(facts.flows.usd).toBeCloseTo(6.02, 1);
    expect(facts.metric).toMatchObject({ target: 130, current: 105 });
    expect(facts.weeklyReport.length).toBeGreaterThan(20);
    expect(facts.product).toBe("proj-b");
  });

  it("parseJsonBlock 兼容围栏与裸 JSON，坏文本抛错", () => {
    expect(parseJsonBlock<{ a: number }>("前言\n```json\n{\"a\":1}\n```\n后记")).toEqual({ a: 1 });
    expect(parseJsonBlock<{ a: number }>("结果是 {\"a\":2} 。")).toEqual({ a: 2 });
    expect(() => parseJsonBlock("nothing here")).toThrow(/JSON/);
  });
});

describe("两次调用与人工采纳（作者锁定）", () => {
  it("第一次只要 delta+evidence，第二次只看 delta 与指标、看不到目标陈述；草稿不改目标", async () => {
    const { goals, reviews } = await seedGoal();
    const runner = new ScriptedRunner([
      "```json\n{\"delta\":\"本周收录数从 98 到 105\",\"evidence\":[\"流 a verified\",\"流 b 回滚\"]}\n```",
      "{\"target\":140,\"direction\":\"up\",\"rationale\":\"按当前速度四周可到 140\"}",
    ]);
    const review = await runGoalReview({ runner, goal: (await goals.read("goal-seo"))!, flows: FLOWS, now: () => NOW, days: 7 });
    expect(runner.calls).toHaveLength(2);
    expect(runner.calls[0]!.system).toBe(REVIEW_DELTA_SYSTEM);
    expect(runner.calls[0]!.input).toContain("SEO 内链");
    expect(runner.calls[1]!.system).toBe(REVIEW_PROPOSAL_SYSTEM);
    expect(runner.calls[1]!.input).toContain("本周收录数从 98 到 105");
    expect(runner.calls[1]!.input).not.toContain("SEO 内链");
    expect(runner.calls[1]!.input).not.toContain("goal-seo");
    expect(runner.calls[1]!.input).not.toContain("proj-b");
    expect(runner.calls[1]!.input).not.toMatch(/更新|accept|采纳/);
    expect(review.status).toBe("draft");
    expect(review.delta.evidence).toHaveLength(2);
    expect(review.proposal).toEqual({ target: 140, direction: "up", rationale: "按当前速度四周可到 140" });
    expect(review.id.startsWith("review-goal-seo-20260916-")).toBe(true);
    await reviews.save(review);
    expect((await reviews.read(review.id))?.status).toBe("draft");
    expect((await goals.read("goal-seo"))!.metric?.target).toBe(130);

    const accepted = await acceptGoalReview(goals, reviews, review.id, "xp");
    expect(accepted.goal.metric?.target).toBe(140);
    expect(accepted.goal.history.at(-1)?.note).toContain("accepted by xp");
    expect(accepted.goal.history.at(-1)?.note).toContain("130 → 140");
    expect(accepted.review.status).toBe("accepted");
    expect(accepted.review.decidedBy).toBe("xp");
    await expect(acceptGoalReview(goals, reviews, review.id, "xp")).rejects.toThrow(/已裁决/);
  });

  it("第二次输出坏 JSON → 草稿仍存但 proposal=null，accept 拒绝；reject 不碰目标", async () => {
    const { goals, reviews } = await seedGoal();
    const runner = new ScriptedRunner(["{\"delta\":\"无变化\",\"evidence\":[]}", "我觉得应该定 150"]);
    const review = await runGoalReview({ runner, goal: (await goals.read("goal-seo"))!, flows: FLOWS, now: () => NOW });
    expect(review.proposal).toBeNull();
    expect(review.proposalError).toMatch(/JSON/);
    await reviews.save(review);
    await expect(acceptGoalReview(goals, reviews, review.id, "xp")).rejects.toThrow(/没有可采纳的提案/);
    const rejected = await rejectGoalReview(reviews, review.id, "xp", "不接受");
    expect(rejected.status).toBe("rejected");
    expect((await goals.read("goal-seo"))!.metric?.target).toBe(130);
    expect((await reviews.list("goal-seo")).map((r) => r.status)).toEqual(["rejected"]);
  });

  it("第一次输出坏 JSON → 直接抛，不存草稿", async () => {
    const { goals } = await seedGoal();
    const runner = new ScriptedRunner(["随便说说", "{}"]);
    await expect(runGoalReview({ runner, goal: (await goals.read("goal-seo"))!, flows: FLOWS, now: () => NOW })).rejects.toThrow(/JSON/);
    expect(runner.calls).toHaveLength(1);
  });
});