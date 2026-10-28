import { join } from "node:path";
import { checkFlowBudget, checkRepoBudget, loadRepoBudget, repoSpentUsd, resolveFlowBudget } from "./flow-budget.js";
import { flowUsdStageMix } from "./flow-cost.js";
import type { FlowTracker } from "./flowstate.js";
import { requestPause } from "./pause-marker.js";

export type BudgetLevel = "ok" | "warn50" | "warn80" | "halt";

export function maxBudgetLevel(a: BudgetLevel, b: BudgetLevel): BudgetLevel {
  const rank = { ok: 0, warn50: 1, warn80: 2, halt: 3 };
  return rank[a] >= rank[b] ? a : b;
}

export interface BudgetVerdict {
  level: BudgetLevel;
  reason: string;
  scope: "flow" | "repo";
  spentUsd: number;
  spentTokens: number;
  ratios: Record<string, number>;
}

export function makeBudgetCheck(opts: {
  repoRoot: string;
  tracker: FlowTracker;
  env: NodeJS.ProcessEnv;
  now?: () => number;
  baselineFlowId?: string;
  log?: (line: string) => void;
}): (ctx: { flowId: string; stage: string }) => Promise<BudgetVerdict> {
  const now = opts.now ?? Date.now;
  let baseline: Promise<{ tokens: number; usd: number }> | undefined;
  return async ({ flowId }) => {
    baseline ??= opts.baselineFlowId === undefined
      ? Promise.resolve({ tokens: 0, usd: 0 })
      : opts.tracker.read(opts.baselineFlowId).then((s) => ({
        tokens: s?.tokensUsed ?? 0,
        usd: s ? flowUsdStageMix(s) : 0,
      }));
    const base = await baseline;
    const s = await opts.tracker.read(flowId);
    if (!s) {
      return { level: "ok", reason: "budget-ok: no-state", scope: "flow", spentUsd: 0, spentTokens: 0, ratios: {} };
    }
    const at = now();
    const spentTokens = Math.max(0, (s.tokensUsed ?? 0) - base.tokens);
    const spentUsd = Math.max(0, flowUsdStageMix(s) - base.usd);
    const flowV = checkFlowBudget({ tokens: spentTokens, elapsedMs: at - s.startedAt, usd: spentUsd }, resolveFlowBudget(opts.env));
    const flows = await opts.tracker.list();
    const repoV = checkRepoBudget(repoSpentUsd(flows, at), loadRepoBudget(join(opts.repoRoot, ".kunpeng")));
    const useFlow = maxBudgetLevel(flowV.level, repoV.level) === flowV.level;
    const verdict: BudgetVerdict = { ...(useFlow ? flowV : repoV), scope: useFlow ? "flow" : "repo", spentUsd, spentTokens };
    if (verdict.level !== "ok") {
      const { level, reason, scope } = verdict;
      await opts.tracker.setBudgetNotice(flowId, { level, reason, scope, spentUsd, spentTokens, at });
      opts.log?.(`[budget] ${flowId} ${scope} ${level}: ${reason}`);
      if (level === "halt") await requestPause(opts.repoRoot, flowId);
    }
    return verdict;
  };
}

export function isBudgetBlocker(blocker: string | undefined): boolean {
  return blocker?.startsWith("budget-exceeded") === true;
}
