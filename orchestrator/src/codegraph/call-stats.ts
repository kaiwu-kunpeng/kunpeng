export interface CallStats {
  calls: Record<string, number>;
  total: number;
}

export function emptyCallStats(): CallStats {
  return { calls: {}, total: 0 };
}

export function bumpCall(stats: CallStats, tool: string): CallStats {
  return {
    calls: {
      ...stats.calls,
      [tool]: (stats.calls[tool] ?? 0) + 1,
    },
    total: stats.total + 1,
  };
}

export function formatCallStats(stats: CallStats): string {
  const calls = Object.entries(stats.calls)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tool, count]) => `${tool}=${count}`);
  return [`total ${stats.total}`, ...calls].join(" | ");
}
