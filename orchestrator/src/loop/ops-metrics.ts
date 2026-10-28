export interface OpsWaveLike {
  at: number;
  verified: boolean;
  metricDelta: number;
  gotchas?: string[];
}

export interface LoopOpsMetrics {
  waves30d: number;
  verifiedRate30d: number;
  metricDelta30d: number;
  lastWaveAt?: number;
  stalled: boolean;
}

const DAY_MS = 86_400_000;
const WINDOW_30D_MS = 30 * DAY_MS;
const DEFAULT_STALL_MS = 14 * DAY_MS;

export function loopOpsMetrics(
  waves: OpsWaveLike[],
  now: number,
  stallMs = DEFAULT_STALL_MS,
): LoopOpsMetrics {
  let waves30d = 0;
  let verified30d = 0;
  let metricDelta30d = 0;
  let lastWaveAt: number | undefined;

  for (const wave of waves) {
    if (lastWaveAt === undefined || wave.at > lastWaveAt) {
      lastWaveAt = wave.at;
    }

    if (now - wave.at <= WINDOW_30D_MS) {
      waves30d += 1;
      if (wave.verified) verified30d += 1;
      metricDelta30d += wave.metricDelta;
    }
  }

  return {
    waves30d,
    verifiedRate30d: waves30d === 0 ? 0 : verified30d / waves30d,
    metricDelta30d,
    lastWaveAt,
    stalled: lastWaveAt === undefined || now - lastWaveAt > stallMs,
  };
}

export function recurringGotchas(
  waves: OpsWaveLike[],
  opts?: { min?: number; top?: number },
): Array<{ gotcha: string; count: number }> {
  const min = opts?.min ?? 2;
  const top = Math.max(0, opts?.top ?? 5);
  const counts = new Map<string, number>();

  for (const wave of waves) {
    const uniqueGotchas = new Set<string>();
    for (const rawGotcha of wave.gotchas ?? []) {
      const gotcha = rawGotcha.trim();
      if (gotcha.length > 0) uniqueGotchas.add(gotcha);
    }

    for (const gotcha of uniqueGotchas) {
      counts.set(gotcha, (counts.get(gotcha) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([gotcha, count]) => ({ gotcha, count }))
    .filter((entry) => entry.count >= min)
    .sort((a, b) => b.count - a.count || compareGotcha(a.gotcha, b.gotcha))
    .slice(0, top);
}

function compareGotcha(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
