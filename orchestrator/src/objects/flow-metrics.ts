export interface FlowTokenSample {
  flowId: string;
  tokensUsed?: number;
  stageTokens?: Record<string, number>;
}

export interface FlowTokenCoverage {
  total: number;
  withTokens: number;
  coverage: number;
}

export function isAggregateFlowId(flowId: unknown): boolean {
  if (typeof flowId !== "string" || flowId.length === 0) {
    return false;
  }

  return flowId.startsWith("plan-") || flowId.startsWith("igate-");
}

export function excludeAggregates(
  samples: readonly FlowTokenSample[],
): FlowTokenSample[] {
  return samples.filter(
    (sample) =>
      typeof sample?.flowId === "string" &&
      sample.flowId.length > 0 &&
      !isAggregateFlowId(sample.flowId),
  );
}

function isFinitePositive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function hasFinitePositiveTokens(
  sample: FlowTokenSample,
): sample is FlowTokenSample & { tokensUsed: number } {
  return isFinitePositive(sample.tokensUsed);
}

export function computeTokenCoverage(
  samples: readonly FlowTokenSample[],
): FlowTokenCoverage {
  const total = samples.length;
  const withTokens = samples.filter(hasFinitePositiveTokens).length;

  return {
    total,
    withTokens,
    coverage: total === 0 ? 0 : withTokens / total,
  };
}

export function summarizeStageTokens(
  samples: readonly FlowTokenSample[],
): Record<string, number> {
  const totals = new Map<string, number>();

  for (const sample of samples) {
    for (const [stage, tokens] of Object.entries(sample.stageTokens ?? {})) {
      if (Number.isFinite(tokens) && tokens >= 0) {
        totals.set(stage, (totals.get(stage) ?? 0) + tokens);
      }
    }
  }

  return Object.fromEntries(totals);
}

export function topFlowsByTokens(
  samples: readonly FlowTokenSample[],
  limit: number,
): FlowTokenSample[] {
  if (limit <= 0) {
    return [];
  }

  return samples
    .filter(hasFinitePositiveTokens)
    .sort((left, right) => right.tokensUsed - left.tokensUsed)
    .slice(0, limit);
}
