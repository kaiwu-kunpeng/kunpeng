export interface CostUsd { byModel: Record<string, number>; totalUsd: number }

/** 单模型四向单价(USD / 百万 token):input=未命中缓存的输入、cacheWrite=缓存写入、cacheRead=缓存命中、output=输出。
 *  按模型名子串匹配,数组顺序即优先级(细的在前)。官方价目 2026-09-04 快照,标准上下文档
 *  (Claude 全系 1M 内同价;OpenAI ≤272K 输入,超出走长上下文价,本表不建模)。
 *  OpenAI 官方价目只列 input/cached/output 三栏,cacheWrite 保守按 1.25×input 计(codex 通常报 0)。 */
export interface ModelRate { match: string; input: number; cacheWrite: number; cacheRead: number; output: number }

export const MODEL_RATE_CARD: ModelRate[] = [
  { match: "fable-5-1", input: 10, cacheWrite: 12.5, cacheRead: 0.25, output: 50 },
  { match: "fable", input: 10, cacheWrite: 12.5, cacheRead: 1, output: 50 },
  { match: "opus", input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  { match: "sonnet-4-6", input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  { match: "sonnet", input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
  { match: "haiku", input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 },
  { match: "astra", input: 10, cacheWrite: 12.5, cacheRead: 1, output: 50 },
  { match: "gpt-6-sol", input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
  { match: "gpt-6-luna", input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
  { match: "5.6-sol", input: 4, cacheWrite: 5, cacheRead: 0.4, output: 20 },
  { match: "5.6-terra", input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 12 },
  { match: "5.6-luna", input: 0.2, cacheWrite: 0.25, cacheRead: 0.02, output: 1.2 },
  { match: "5.4-mini", input: 0.75, cacheWrite: 0.9375, cacheRead: 0.075, output: 4.5 },
  { match: "gpt", input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 30 },
  { match: "codex", input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 30 },
  { match: "high", input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 30 },
];

/** 未知模型兜底(haiku 档,混合价 = 3,与 DEFAULT_PRICE_PER_MTOK 一致)。 */
export const DEFAULT_MODEL_RATE: ModelRate = { match: "", input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 };

/** 单数 token 路径(流阶段只落一个计费 token 数)用的混合单价 = (input+output)/2,由价目表推导;前端 KP_PRICING 也吃这张表。 */
export const MODEL_PRICING_PER_MTOK: { match: string; usd: number }[] =
  MODEL_RATE_CARD.map((rate) => ({ match: rate.match, usd: (rate.input + rate.output) / 2 }));

export const DEFAULT_PRICE_PER_MTOK = (DEFAULT_MODEL_RATE.input + DEFAULT_MODEL_RATE.output) / 2;

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function safeToken(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** 按模型名子串匹配价目表,未命中返回 DEFAULT_MODEL_RATE。纯函数不抛。 */
export function rateCardForModel(model: string): ModelRate {
  const normalized = String(model ?? "").toLowerCase();
  return MODEL_RATE_CARD.find((rate) => normalized.includes(rate.match)) ?? DEFAULT_MODEL_RATE;
}

function rateForModel(model: string): number {
  const rate = rateCardForModel(model);
  return rate === DEFAULT_MODEL_RATE ? DEFAULT_PRICE_PER_MTOK : (rate.input + rate.output) / 2;
}

/** 四向精确计价:有 input/output/cacheCreate/cacheRead 拆分时用它(chat 每轮 usage 都有)。
 *  缺失/非有限/负数按 0;返回非负有限 USD(不取整,调用方自行 toFixed)。 */
export function estimateUsageCostUsd(
  usage: { input?: number; output?: number; cacheCreate?: number; cacheRead?: number },
  model: string,
): number {
  const rate = rateCardForModel(model);
  const usd = (
    safeToken(usage.input) * rate.input
    + safeToken(usage.output) * rate.output
    + safeToken(usage.cacheCreate) * rate.cacheWrite
    + safeToken(usage.cacheRead) * rate.cacheRead
  ) / 1_000_000;
  return Number.isFinite(usd) && usd > 0 ? usd : 0;
}

/** tokensByModel: model→计费 token 数;按混合单价算每模型 + 总 USD(保留 4 位)。纯函数不抛。 */
export function estimateCostUsd(tokensByModel: Record<string, number>): CostUsd {
  const byModel: Record<string, number> = {};
  let totalUsd = 0;

  for (const [model, tokens] of Object.entries(tokensByModel)) {
    const cost = (tokens / 1_000_000) * rateForModel(model);
    byModel[model] = round4(cost);
    totalUsd += cost;
  }

  return { byModel, totalUsd: round4(totalUsd) };
}