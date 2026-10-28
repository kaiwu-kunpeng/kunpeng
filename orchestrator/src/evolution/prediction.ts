/** 进化提案的可证伪预测（AHE「决策可观测」）：每条改动声明「改了之后哪项指标、往哪个方向、至少变多少、观察几天」，
 *  采纳满窗口后由确定性核对器用流数据复核。纯模块，不做 I/O。 */

export const PREDICTION_METRICS = ["verifiedRate", "rollbackTokenShare", "tokensPerVerified"] as const;
export type PredictionMetric = (typeof PREDICTION_METRICS)[number];

export const PREDICTION_METRIC_LABELS: Record<PredictionMetric, string> = {
  verifiedRate: "真实流通过率",
  rollbackTokenShare: "回滚流 token 占比",
  tokensPerVerified: "每条 verified 流耗 token",
};

export interface Prediction {
  metric: PredictionMetric;
  direction: "up" | "down";
  minDelta: number;
  windowDays: number;
}

export const MAX_PREDICTION_WINDOW_DAYS = 60;

/** 校验外部（LLM）给出的预测；任一字段不合格返回 undefined。 */
export function parsePrediction(value: unknown): Prediction | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const metric = raw.metric;
  if (typeof metric !== "string" || !(PREDICTION_METRICS as readonly string[]).includes(metric)) return undefined;
  if (raw.direction !== "up" && raw.direction !== "down") return undefined;
  const minDelta = raw.minDelta;
  if (typeof minDelta !== "number" || !Number.isFinite(minDelta) || minDelta <= 0) return undefined;
  const windowDays = raw.windowDays;
  if (typeof windowDays !== "number" || !Number.isInteger(windowDays) || windowDays < 1 || windowDays > MAX_PREDICTION_WINDOW_DAYS) {
    return undefined;
  }
  return { metric: metric as PredictionMetric, direction: raw.direction, minDelta, windowDays };
}

/** 人话描述，进提案正文，如「真实流通过率 上升 ≥ 0.05（观察 14 天）」。 */
export function describePrediction(prediction: Prediction): string {
  const arrow = prediction.direction === "up" ? "上升" : "下降";
  return `${PREDICTION_METRIC_LABELS[prediction.metric]} ${arrow} ≥ ${prediction.minDelta}（观察 ${prediction.windowDays} 天）`;
}
