const MIN_STEP_TIMEOUT_MS = 60_000;
const MAX_STEP_TIMEOUT_MS = 3_600_000;

function normalizeTimeoutMs(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;

  const normalized = Math.floor(value);
  return normalized >= MIN_STEP_TIMEOUT_MS && normalized <= MAX_STEP_TIMEOUT_MS
    ? normalized
    : undefined;
}

export function resolveStepTimeoutMs(
  stepTimeoutMs: number | undefined,
  env: Record<string, string | undefined>,
): number | undefined {
  const normalizedStepTimeoutMs = stepTimeoutMs === undefined
    ? undefined
    : normalizeTimeoutMs(stepTimeoutMs);
  if (normalizedStepTimeoutMs !== undefined) return normalizedStepTimeoutMs;

  const envValue = env.KUNPENG_AGENT_STEP_TIMEOUT_MS;
  if (envValue === undefined) return undefined;
  return normalizeTimeoutMs(Number(envValue));
}
