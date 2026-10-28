export interface PerfSample {
  label: string;
  ms?: number;
  bytes?: number;
}

export interface PerfProfile {
  samples: PerfSample[];
  totalMs: number;
  totalBytes: number;
  bottlenecks: PerfSample[];
}

export function buildPerfProfile(
  samples: PerfSample[],
  opts: { by?: "ms" | "bytes"; topN?: number } = {},
): PerfProfile {
  const by = opts.by ?? "ms";
  const topN = opts.topN ?? 5;
  const sampleCopies = [...samples];

  const totalMs = sampleCopies.reduce((sum, sample) => sum + (sample.ms ?? 0), 0);
  const totalBytes = sampleCopies.reduce((sum, sample) => sum + (sample.bytes ?? 0), 0);

  const bottlenecks = sampleCopies
    .map((sample, index) => ({ sample, index }))
    .sort((left, right) => {
      const diff = (right.sample[by] ?? 0) - (left.sample[by] ?? 0);
      return diff === 0 ? left.index - right.index : diff;
    })
    .slice(0, topN)
    .map(({ sample }) => sample);

  return {
    samples: sampleCopies,
    totalMs,
    totalBytes,
    bottlenecks,
  };
}
