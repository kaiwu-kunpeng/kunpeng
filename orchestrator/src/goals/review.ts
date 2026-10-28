import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentRunner } from "../agent/runner.js";
import { buildWeeklyReport } from "../metrics/weekly-report.js";
import { flowUsdStageMix, flowsUsdStageMix } from "../runtime/flow-cost.js";
import type { FlowState } from "../runtime/flowstate.js";
import { writeFileAtomic } from "../util/atomic-write.js";
import { goalBucket, type Goal, type GoalStore } from "./store.js";
import { isRecord } from "../util/is-record.js";

export interface GoalReviewFacts {
  goalId: string;
  product: string;
  sinceMs: number;
  untilMs: number;
  flows: { total: number; verified: number; rolledBack: number; usd: number; changedFiles: number };
  metric?: { key: string; label: string; target: number; direction: "up" | "down"; current?: number };
  weeklyReport: string;
}

export interface GoalReviewDelta { delta: string; evidence: string[] }
export interface GoalReviewProposal { target: number; direction: "up" | "down"; rationale: string }
export interface GoalReview {
  id: string;
  goalId: string;
  at: number;
  facts: GoalReviewFacts;
  delta: GoalReviewDelta;
  proposal: GoalReviewProposal | null;
  proposalError?: string;
  status: "draft" | "accepted" | "rejected";
  decidedBy?: string;
  decidedAt?: number;
}

export function buildGoalReviewFacts(
  goal: Goal, flows: readonly FlowState[], window: { sinceMs: number; untilMs: number },
): GoalReviewFacts {
  const { sinceMs, untilMs } = window;
  const selected = flows.filter((flow) => goalBucket(flow) === goal.id
    && flow.updatedAt >= sinceMs && flow.updatedAt < untilMs);
  const metric = goal.metric;
  return {
    goalId: goal.id, product: goal.product, sinceMs, untilMs,
    flows: {
      total: selected.length,
      verified: selected.filter((flow) => flow.status === "verified").length,
      rolledBack: selected.filter((flow) => flow.status === "rolled-back").length,
      usd: Math.round(flowsUsdStageMix(selected) * 100) / 100,
      changedFiles: selected.reduce((sum, flow) => sum + (flow.changedFileCount ?? 0), 0),
    },
    ...(metric ? { metric: {
      key: metric.key, label: metric.label, target: metric.target, direction: metric.direction,
      ...(metric.current !== undefined ? { current: metric.current } : {}),
    } } : {}),
    weeklyReport: buildWeeklyReport({
      flows: selected.map((flow) => ({
        id: flow.flowId, status: flow.status, at: flow.updatedAt, usd: flowUsdStageMix(flow),
        tokens: flow.tokenQuad ?? { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
      })),
      sinceMs, untilMs,
    }),
  };
}

export const REVIEW_DELTA_SYSTEM = '你是复盘记录员。只陈述本期发生了什么和证据，不提任何建议、不预测、不评价目标合理性。只输出 JSON：{"delta": string, "evidence": string[]}。';
export const REVIEW_PROPOSAL_SYSTEM = '你是指标校准器。根据给定的本期变化与证据，为下一期提一个可量化的目标值。只输出 JSON：{"target": number, "direction": "up"|"down", "rationale": string}。';

export function parseJsonBlock<T>(text: string): T {
  const fenced = /```json\s*([\s\S]*?)```/.exec(text);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  try {
    if (!fenced && (start < 0 || end < start)) throw new Error();
    return JSON.parse(fenced ? fenced[1] : text.slice(start, end + 1)) as T;
  } catch {
    throw new Error("复盘输出不是合法 JSON");
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isDelta(value: unknown): value is GoalReviewDelta {
  return isRecord(value) && typeof value.delta === "string" && Array.isArray(value.evidence)
    && value.evidence.every((entry: unknown) => typeof entry === "string");
}

function isProposal(value: unknown): value is GoalReviewProposal {
  return isRecord(value) && isFiniteNumber(value.target)
    && (value.direction === "up" || value.direction === "down") && typeof value.rationale === "string";
}

export async function runGoalReview(deps: {
  runner: AgentRunner; goal: Goal; flows: readonly FlowState[]; now?: () => number; days?: number; cwd?: string;
}): Promise<GoalReview> {
  const { runner, goal, flows, cwd } = deps;
  const untilMs = (deps.now ?? Date.now)();
  const sinceMs = untilMs - (deps.days ?? 7) * 86_400_000;
  const facts = buildGoalReviewFacts(goal, flows, { sinceMs, untilMs });
  const first = await runner.run({
    stage: "review", system: REVIEW_DELTA_SYSTEM,
    input: JSON.stringify({ goal: { id: goal.id, product: goal.product, statement: goal.statement, metric: goal.metric }, facts }, null, 2),
    tools: [], cwd,
  });
  const delta = parseJsonBlock<GoalReviewDelta>(first.text);
  if (!isDelta(delta)) throw new Error("复盘 delta 字段不合法");

  let proposal: GoalReviewProposal | null = null;
  let proposalError: string | undefined;
  try {
    const second = await runner.run({
      stage: "review", system: REVIEW_PROPOSAL_SYSTEM,
      input: JSON.stringify({ delta: delta.delta, evidence: delta.evidence, metric: facts.metric ?? null }),
      tools: [], cwd,
    });
    const parsed = parseJsonBlock<GoalReviewProposal>(second.text);
    if (!isProposal(parsed)) throw new Error("复盘 proposal 字段不合法");
    proposal = { target: parsed.target, direction: parsed.direction, rationale: parsed.rationale };
  } catch (error) {
    proposalError = error instanceof Error ? error.message : String(error);
  }
  const date = new Date(untilMs).toISOString().slice(0, 10).replace(/-/g, "");
  return {
    id: `review-${goal.id}-${date}-${untilMs.toString(36)}`,
    goalId: goal.id, at: untilMs, facts, delta, proposal,
    ...(proposalError ? { proposalError } : {}), status: "draft",
  };
}

function isReview(value: unknown): value is GoalReview {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.goalId !== "string"
    || !isFiniteNumber(value.at) || !isDelta(value.delta)
    || (value.proposal !== null && !isProposal(value.proposal))
    || !["draft", "accepted", "rejected"].includes(String(value.status))) return false;
  const facts = value.facts;
  if (!isRecord(facts) || facts.goalId !== value.goalId || typeof facts.product !== "string"
    || !isFiniteNumber(facts.sinceMs) || !isFiniteNumber(facts.untilMs)
    || typeof facts.weeklyReport !== "string" || !isRecord(facts.flows)) return false;
  const counts = facts.flows;
  if (!["total", "verified", "rolledBack", "usd", "changedFiles"].every((key) => isFiniteNumber(counts[key]))) return false;
  const metric = facts.metric;
  if (metric !== undefined && (!isRecord(metric) || typeof metric.key !== "string"
    || typeof metric.label !== "string" || !isFiniteNumber(metric.target)
    || (metric.direction !== "up" && metric.direction !== "down")
    || (metric.current !== undefined && !isFiniteNumber(metric.current)))) return false;
  return (value.proposalError === undefined || typeof value.proposalError === "string")
    && (value.decidedBy === undefined || typeof value.decidedBy === "string")
    && (value.decidedAt === undefined || isFiniteNumber(value.decidedAt));
}

export class GoalReviewStore {
  private warned = new Set<string>();

  constructor(private dir: string) {}

  private path(id: string): string {
    if (!id || id.includes("/") || id.includes("..")) throw new Error(`非法复盘 id：${id}`);
    return join(this.dir, `${id}.json`);
  }

  async save(review: GoalReview): Promise<void> {
    await writeFileAtomic(this.path(review.id), `${JSON.stringify(review, null, 2)}\n`);
  }

  async read(id: string): Promise<GoalReview | null> {
    const path = this.path(id);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const review: unknown = JSON.parse(text);
    if (!isReview(review) || review.id !== id) throw new Error(`复盘文件形状不合法：${id}`);
    return review;
  }

  async list(goalId?: string): Promise<GoalReview[]> {
    const entries = await readdir(this.dir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const reviews: GoalReview[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const review = await this.read(entry.name.slice(0, -5));
        if (review && (goalId === undefined || review.goalId === goalId)) reviews.push(review);
      } catch (error) {
        if (!this.warned.has(entry.name)) {
          this.warned.add(entry.name);
          console.warn(`[review] 复盘文件损坏或不可读，已跳过：${join(this.dir, entry.name)}：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    return reviews.sort((a, b) => b.at - a.at);
  }
}

export async function acceptGoalReview(
  goals: GoalStore, reviews: GoalReviewStore, reviewId: string, by: string,
): Promise<{ goal: Goal; review: GoalReview }> {
  const review = await reviews.read(reviewId);
  if (!review) throw new Error(`复盘不存在：${reviewId}`);
  if (review.status !== "draft") throw new Error("该复盘已裁决");
  if (review.proposal === null) throw new Error("该复盘没有可采纳的提案");
  const previous = await goals.read(review.goalId);
  if (!previous) throw new Error(`目标不存在：${review.goalId}`);
  const { target, direction } = review.proposal;
  const goal = await goals.setTarget(review.goalId, target, direction,
    `review ${reviewId} accepted by ${by}: target ${previous.metric?.target ?? "-"} → ${target}`, by);
  if (!goal) throw new Error(`目标不存在：${review.goalId}`);
  const accepted: GoalReview = { ...review, status: "accepted", decidedBy: by, decidedAt: Date.now() };
  await reviews.save(accepted);
  return { goal, review: accepted };
}

export async function rejectGoalReview(
  reviews: GoalReviewStore, reviewId: string, by: string, note?: string,
): Promise<GoalReview> {
  const review = await reviews.read(reviewId);
  if (!review) throw new Error(`复盘不存在：${reviewId}`);
  if (review.status !== "draft") throw new Error("该复盘已裁决");
  const rejected: GoalReview = {
    ...review, status: "rejected", decidedBy: by, decidedAt: Date.now(),
    ...(note !== undefined ? { note } : {}),
  };
  await reviews.save(rejected);
  return rejected;
}
