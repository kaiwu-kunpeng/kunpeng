import { join } from "node:path";
import { GoalStore, UNASSIGNED_GOAL_ID, goalBucket, goalProgress, goalsDir, isGoalId, type GoalMetric } from "../goals/store.js";
import { GoalReviewStore, acceptGoalReview, rejectGoalReview, runGoalReview } from "../goals/review.js";
import { resolveProjectStateDir } from "../project/state-resolve.js";
import { flowsUsdStageMix } from "../runtime/flow-cost.js";
import { FlowTracker } from "../runtime/flowstate.js";
import { createContext } from "../sdk/context.js";
import { registerCliCommand, type CliContext } from "./registry.js";

const valueFlags = new Set(["--id", "--owner", "--budget-usd", "--due", "--metric"]);

function usage(): never {
  console.error("用法: kunpeng goal add <product> <statement…> [--id goal-…] [--owner <owner>] [--budget-usd <number>] [--due YYYY-MM-DD] [--metric key:label:target:up|down]\n"
    + "      kunpeng goal list [--json]\n"
    + "      kunpeng goal done|pause <id>\n"
    + "      kunpeng goal set-current <id> <value>\n"
    + "      kunpeng goal review <goalId> [--days N]\n"
    + "      kunpeng goal accept <reviewId>\n"
    + "      kunpeng goal reject <reviewId> [note…]\n"
    + "      kunpeng goal reviews [<goalId>]");
  process.exit(1);
}

function finiteNumber(text: string | undefined): number {
  if (text === undefined || !text.trim() || !Number.isFinite(Number(text))) usage();
  return Number(text);
}

function parseAdd(context: CliContext): Parameters<GoalStore["create"]>[0] {
  const values = new Map<string, string>();
  for (let i = 0; i < context.argv.length; i++) {
    const flag = context.argv[i];
    if (!valueFlags.has(flag)) continue;
    const value = context.argv[++i];
    if (!value?.trim() || value.startsWith("--")) usage();
    values.set(flag, value);
  }
  const product = context.rest[1];
  const words: string[] = [];
  for (let i = 2; i < context.rest.length; i++) {
    const word = context.rest[i];
    if (valueFlags.has(word)) { i++; continue; }
    if (word.startsWith("--")) usage();
    words.push(word);
  }
  const statement = words.join(" ").trim();
  if (!product?.trim() || product.startsWith("--") || !statement) usage();
  const id = values.get("--id");
  if (id !== undefined && !isGoalId(id)) usage();
  const budgetUsd = values.has("--budget-usd") ? finiteNumber(values.get("--budget-usd")) : undefined;
  let due: number | undefined;
  const date = values.get("--due");
  if (date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) usage();
    due = Date.parse(date);
    if (!Number.isFinite(due) || new Date(due).toISOString().slice(0, 10) !== date) usage();
  }
  let metric: GoalMetric | undefined;
  const rawMetric = values.get("--metric");
  if (rawMetric !== undefined) {
    const parts = rawMetric.split(":");
    const [key, label, targetText, direction] = parts;
    if (parts.length !== 4 || !key.trim() || !label.trim() || (direction !== "up" && direction !== "down")) usage();
    metric = { key, label, target: finiteNumber(targetText), direction };
  }
  return { id, product, statement, owner: values.get("--owner"), budgetUsd, due, metric };
}

async function run(context: CliContext): Promise<void> {
  const store = new GoalStore(goalsDir(join(context.repoRoot, ".kunpeng")));
  const subcommand = context.rest[0];
  if (subcommand === "add") {
    const goal = await store.create(parseAdd(context));
    console.log(`[goal] 已登记 ${goal.id}（${goal.product}）`);
    return;
  }
  if (subcommand === "list") {
    const flows = await new FlowTracker(resolveProjectStateDir(context.repoRoot)).list();
    const goals = (await store.list()).map((goal) => {
      const assigned = flows.filter((flow) => goalBucket(flow) === goal.id);
      return {
        ...goal,
        flows: { total: assigned.length, verified: assigned.filter((flow) => flow.status === "verified").length },
        usd: Math.round(flowsUsdStageMix(assigned) * 100) / 100,
        progress: goalProgress(goal),
      };
    });
    const unassigned = flows.filter((flow) => goalBucket(flow) === UNASSIGNED_GOAL_ID).length;
    if (context.argv.includes("--json")) {
      console.log(JSON.stringify({ goals, unassigned }, null, 2));
    } else {
      for (const goal of goals) {
        console.log(`${goal.id}  ${goal.product}  ${goal.status}  流 ${goal.flows.verified}/${goal.flows.total}  $${goal.usd}  进度 ${goal.progress ?? "-"}  ${goal.statement}`);
      }
      console.log(`未归属流：${unassigned}`);
    }
    return;
  }
  if (subcommand === "done" || subcommand === "pause") {
    const id = context.rest[1];
    if (!id || !isGoalId(id)) usage();
    const goal = await store.setStatus(id, subcommand === "done" ? "done" : "paused");
    if (!goal) { console.error(`[goal] 目标不存在：${id}`); process.exit(1); }
    console.log(`[goal] ${id} ${goal.status}`);
    return;
  }
  if (subcommand === "set-current") {
    const id = context.rest[1];
    if (!id || !isGoalId(id)) usage();
    const value = finiteNumber(context.rest[2]);
    const goal = await store.setCurrent(id, value);
    if (!goal) { console.error(`[goal] 目标不存在：${id}`); process.exit(1); }
    console.log(`[goal] ${id} current=${value} 进度 ${goalProgress(goal) ?? "-"}`);
    return;
  }
  const reviews = new GoalReviewStore(join(goalsDir(join(context.repoRoot, ".kunpeng")), "reviews"));
  try {
    if (subcommand === "review") {
      const id = context.rest[1];
      if (!id || !isGoalId(id)) usage();
      const daysIndex = context.argv.indexOf("--days");
      const days = daysIndex < 0 ? undefined : finiteNumber(context.argv[daysIndex + 1]);
      if (days !== undefined && days <= 0) usage();
      const goal = await store.read(id);
      if (!goal) { console.error(`[goal] 目标不存在：${id}`); process.exit(1); }
      const { runner, tracker } = await createContext(context.repoRoot, context.kunpengHome);
      const review = await runGoalReview({ runner, goal, flows: await tracker.list(), days, cwd: context.repoRoot });
      await reviews.save(review);
      console.log(`[review] 草稿 ${review.id}`);
      console.log(`变化：${review.delta.delta}`);
      for (const evidence of review.delta.evidence) console.log(`  - ${evidence}`);
      console.log(review.proposal
        ? `提案：target ${review.proposal.target}（${review.proposal.direction}）— ${review.proposal.rationale}`
        : `提案：无（${review.proposalError}）`);
      console.log(`采纳：kunpeng goal accept ${review.id}；驳回：kunpeng goal reject ${review.id}`);
      return;
    }
    if (subcommand === "accept") {
      const id = context.rest[1];
      if (!id) usage();
      const { goal } = await acceptGoalReview(store, reviews, id, process.env.USER ?? "owner");
      console.log(`[goal] ${goal.id} target=${goal.metric?.target}（${goal.metric?.direction}）`);
      return;
    }
    if (subcommand === "reject") {
      const id = context.rest[1];
      if (!id) usage();
      const note = context.rest.slice(2).join(" ") || undefined;
      const review = await rejectGoalReview(reviews, id, process.env.USER ?? "owner", note);
      console.log(`[goal] 复盘 ${review.id} 已驳回`);
      return;
    }
    if (subcommand === "reviews") {
      for (const review of await reviews.list(context.rest[1])) {
        console.log(`${review.id}  ${review.status}  ${review.goalId}  提案 ${review.proposal?.target ?? "-"}`);
      }
      return;
    }
  } catch (error) {
    console.error("[goal] " + (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
  usage();
}

registerCliCommand({ name: "goal", run });
