export interface TokenQuadrants {
  freshInput: number;
  cacheCreate: number;
  cacheRead: number;
  output: number;
}

export interface TokenPrices {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

export interface CacheUsage {
  input: number;
  cacheCreate: number;
  cacheRead: number;
}

/** 输入侧 token 中由缓存读取命中的比例。 */
export function cacheHitRate(usage: CacheUsage): number | null {
  const total = usage.input + usage.cacheCreate + usage.cacheRead;
  if (total === 0) return null;
  return Math.min(1, Math.max(0, usage.cacheRead / total));
}

export function hitRateGrade(rate: number | null): "good" | "warn" | "bad" | "n/a" {
  if (rate === null) return "n/a";
  if (rate >= 0.5) return "good";
  if (rate >= 0.2) return "warn";
  return "bad";
}

export function quadrantsFromUsage(usage: {
  input?: number;
  output?: number;
  cacheCreate?: number;
  cacheRead?: number;
}): TokenQuadrants {
  return {
    freshInput: usage.input ?? 0,
    cacheCreate: usage.cacheCreate ?? 0,
    cacheRead: usage.cacheRead ?? 0,
    output: usage.output ?? 0,
  };
}

export function costUsd(
  q: TokenQuadrants,
  p: TokenPrices,
): {
  total: number;
  byQuadrant: {
    freshInput: number;
    cacheCreate: number;
    cacheRead: number;
    output: number;
  };
} {
  const byQuadrant = {
    freshInput: (q.freshInput / 1_000_000) * p.input,
    cacheCreate: (q.cacheCreate / 1_000_000) * p.cacheWrite,
    cacheRead: (q.cacheRead / 1_000_000) * p.cacheRead,
    output: (q.output / 1_000_000) * p.output,
  };

  return {
    total:
      byQuadrant.freshInput +
      byQuadrant.cacheCreate +
      byQuadrant.cacheRead +
      byQuadrant.output,
    byQuadrant,
  };
}
