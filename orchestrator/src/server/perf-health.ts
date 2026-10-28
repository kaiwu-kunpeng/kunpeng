export interface PerfHealthInput {
  stateCollectMs?: number;
  eventLoopDelayMs?: number;
  cacheHitRate?: number;
  slowRequests?: Array<{ path: string; ms: number }>;
}

export interface PerfHealthSnapshot {
  ok: boolean;
  warnings: string[];
  metrics: PerfHealthInput;
}

export function perfHealthSnapshot(input: PerfHealthInput): PerfHealthSnapshot {
  const warnings: string[] = [];

  if (input.stateCollectMs !== undefined && input.stateCollectMs > 1000) {
    warnings.push(`状态采集耗时过高: ${input.stateCollectMs}ms`);
  }

  if (input.eventLoopDelayMs !== undefined && input.eventLoopDelayMs > 200) {
    warnings.push(`事件循环延迟过高: ${input.eventLoopDelayMs}ms`);
  }

  for (const request of input.slowRequests ?? []) {
    if (request.ms > 500) {
      warnings.push(`慢请求 ${request.path}: ${request.ms}ms`);
    }
  }

  return {
    ok: warnings.length === 0,
    warnings,
    metrics: { ...input },
  };
}
