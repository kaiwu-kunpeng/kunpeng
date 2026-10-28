import { buildCostReport, type CostReport } from "./cost-report.js";
import { estimateCostUsd } from "./cost-pricing.js";
import { cacheHitRate, type CacheUsage } from "../metrics/cache-cost.js";

export interface FlowUsdLike {
  tokensUsed?: number;
  backend?: string;
  stageTokens?: Record<string, number>;
  stageBackends?: Record<string, string>;
  stageModels?: Record<string, string>;
}

export function flowUsdStageMix(flow: FlowUsdLike): number {
  if (Object.values(flow.stageTokens ?? {}).some((tokens) => Number.isFinite(tokens) && tokens > 0)) {
    return flowsToCostReport([flow]).cost.totalUsd;
  }
  return estimateCostUsd({ [flow.backend ?? "default"]: flow.tokensUsed ?? 0 }).totalUsd;
}

export function flowsUsdStageMix(flows: readonly FlowUsdLike[]): number {
  const totalUsd = flows.reduce((total, flow) => total + flowUsdStageMix(flow), 0);
  return Math.round(totalUsd * 10000) / 10000;
}

type PartialCacheUsage = Partial<CacheUsage>;

interface FlowCostLike extends PartialCacheUsage {
  tokensUsed?: number;
  stageTokens?: Record<string, number>;
  stageBackends?: Record<string, string>;
  stageModels?: Record<string, string>;
  usage?: PartialCacheUsage;
  stageUsage?: Record<string, PartialCacheUsage>;
}

export interface FlowCostReport extends CostReport {
  /** 全部 flow/stage 输入侧 token 的缓存读取命中率。 */
  cacheHitRate: number | null;
  /** 与 tokensByModel 相同模型粒度的缓存读取命中率。 */
  cacheHitRateByModel: Record<string, number | null>;
}

function normalizedUsage(usage: PartialCacheUsage): CacheUsage {
  const token = (value: number | undefined): number =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  return {
    input: token(usage.input),
    cacheCreate: token(usage.cacheCreate),
    cacheRead: token(usage.cacheRead),
  };
}

function addUsage(target: CacheUsage, usage: PartialCacheUsage): void {
  const normalized = normalizedUsage(usage);
  target.input += normalized.input;
  target.cacheCreate += normalized.cacheCreate;
  target.cacheRead += normalized.cacheRead;
}

function hasUsage(usage: PartialCacheUsage | undefined): usage is PartialCacheUsage {
  return usage !== undefined && [usage.input, usage.cacheCreate, usage.cacheRead].some((value) => typeof value === "number");
}

/** 从 flow 的按阶段 token + 后端推一份真实成本报告（token 精确，USD 走 estimateCostUsd 定价）。纯函数。 */
export function flowsToCostReport(flows: FlowCostLike[]): FlowCostReport {
  const stages: { stage: string; model: string; tokens: number }[] = [];
  const totalUsage: CacheUsage = { input: 0, cacheCreate: 0, cacheRead: 0 };
  const usageByModel: Record<string, CacheUsage> = {};
  for (const flow of flows) {
    let usedStageUsage = false;
    const st = flow.stageTokens;
    if (st && Object.keys(st).length > 0) {
      for (const [stage, tokens] of Object.entries(st)) {
        if (!Number.isFinite(tokens) || tokens <= 0) continue;
        const model = flow.stageModels?.[stage] ?? flow.stageBackends?.[stage] ?? "unknown";
        stages.push({ stage, model, tokens });
        const usage = flow.stageUsage?.[stage];
        if (hasUsage(usage)) {
          usedStageUsage = true;
          addUsage(totalUsage, usage);
          const modelUsage = usageByModel[model] ?? { input: 0, cacheCreate: 0, cacheRead: 0 };
          addUsage(modelUsage, usage);
          usageByModel[model] = modelUsage;
        }
      }
    } else if (typeof flow.tokensUsed === "number" && flow.tokensUsed > 0) {
      // 无按阶段明细但有总数 → 兜底归到 unknown 模型（按默认价）。
      stages.push({ stage: "(flow)", model: "unknown", tokens: flow.tokensUsed });
    }

    if (!usedStageUsage) {
      const usage = hasUsage(flow.usage) ? flow.usage : hasUsage(flow) ? flow : undefined;
      if (usage) {
        addUsage(totalUsage, usage);
        const model = flow.stageModels?.["(flow)"] ?? flow.stageBackends?.["(flow)"] ?? "unknown";
        const modelUsage = usageByModel[model] ?? { input: 0, cacheCreate: 0, cacheRead: 0 };
        addUsage(modelUsage, usage);
        usageByModel[model] = modelUsage;
      }
    }
  }
  const report = buildCostReport(stages);
  const cacheHitRateByModel = Object.fromEntries(
    Object.keys(report.tokensByModel).map((model) => [model, cacheHitRate(usageByModel[model] ?? { input: 0, cacheCreate: 0, cacheRead: 0 })]),
  );
  return {
    ...report,
    cacheHitRate: cacheHitRate(totalUsage),
    cacheHitRateByModel,
  };
}
