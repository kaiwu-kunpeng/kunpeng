import type { Stage } from "./runner.js";

/** 单 stage 的算力分层选择：claude 用 model tier，codex 用 effort 档。 */
export interface StageModel {
  model?: string;
  effort?: string;
}

/** claude 全阶段 Opus 5（2026-09-07 用户指定升级；省 token 走缓存/effort，不降主链模型）。 */
export const CLAUDE_TIER: Record<Stage, StageModel> = {
  spec: { model: "claude-opus-5" },
  verify: { model: "claude-opus-5" },
  implement: { model: "claude-opus-5" },
  review: { model: "claude-opus-5" },
  design: { model: "claude-opus-5" },
  audit: { model: "claude-opus-5" },
};

/** codex 后端：按 effort 档分层；写代码（implement）用 xhigh（gpt-5.5 默认），其余 low。 */
export const CODEX_TIER: Record<Stage, StageModel> = {
  spec: { effort: "low" },
  design: { effort: "low" },
  review: { effort: "low" },
  audit: { effort: "low" },
  verify: { effort: "low" },
  implement: { effort: "xhigh" },
};

/** codex 后端 V2：写代码（implement）用 GPT-6 Astra xhigh（2026-09-07 用户指定升级），其余 stage 按 gpt-5.6 三档分层，并保留 effort。 */
const CODEX_TIER_V2: Record<Stage, StageModel> = {
  spec: { model: "gpt-5.6-luna", effort: "low" },
  design: { model: "gpt-5.6-luna", effort: "low" },
  implement: { model: "gpt-6-astra", effort: "xhigh" },
  review: { model: "gpt-5.6-terra", effort: "medium" },
  audit: { model: "gpt-5.6-terra", effort: "medium" },
  verify: { model: "gpt-5.6-luna", effort: "low" },
};

const STAGES: Stage[] = ["spec", "design", "implement", "review", "verify", "audit"];

function envRouteOverride(env: Record<string, string | undefined>): Partial<Record<Stage, StageModel>> {
  const raw = env.KUNPENG_MODEL_ROUTE;
  if (!raw) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const record = parsed as Record<string, unknown>;
    const out: Partial<Record<Stage, StageModel>> = {};
    for (const stage of STAGES) {
      const value = record[stage];
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const route = value as Record<string, unknown>;
      const model = route.model;
      const effort = route.effort;
      const override: StageModel = {};
      if (typeof model === "string") override.model = model;
      if (typeof effort === "string") override.effort = effort;
      if (override.model !== undefined || override.effort !== undefined) out[stage] = override;
    }
    return out;
  } catch {
    return {};
  }
}

/** 按 stage + backend 返回实际调度路线。claude 固定沿用 CLAUDE_TIER；codex 走 gpt-5.6 V2 表。 */
export function scheduledRoute(
  stage: Stage,
  backend: "claude" | "codex",
  env: Record<string, string | undefined>,
): StageModel {
  if (backend === "claude") return CLAUDE_TIER[stage];
  return { ...CODEX_TIER_V2[stage], ...(envRouteOverride(env)[stage] ?? {}) };
}

/** 按 stage + backend 返回算力分层选择。 */
export function routeForStage(
  stage: Stage,
  backend: "claude" | "codex",
): StageModel {
  return backend === "claude" ? CLAUDE_TIER[stage] : CODEX_TIER[stage];
}
