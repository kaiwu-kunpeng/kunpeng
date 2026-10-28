import type { EstimateForecast, TaskEstimate } from "./contract.js";

const DEFAULT_VELOCITY_RATIOS: readonly number[] = [0.6, 0.75, 0.9, 1.0, 1.15, 1.4, 1.8];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }

  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

export function velocityFromHistory(samples: { estimateHours: number; actualHours: number }[]): number[] {
  return samples
    .filter((sample) => sample.estimateHours > 0)
    .map((sample) => sample.actualHours / sample.estimateHours)
    .filter((ratio) => Number.isFinite(ratio) && ratio > 0);
}

export function estimateProject(
  tasks: TaskEstimate[],
  velocities: number[],
  opts?: { iterations?: number; seed?: number },
): EstimateForecast {
  const vels = velocities.length ? velocities : [...DEFAULT_VELOCITY_RATIOS];
  const calibrated = velocities.length > 0;
  const iterations = opts?.iterations ?? 2000;
  const rand = mulberry32(opts?.seed ?? 0x9e3779b9);

  if (tasks.length === 0) {
    return { expectedHours: 0, p50: 0, p80: 0, p95: 0, iterations, calibrated };
  }

  const totals: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    let total = 0;
    for (const task of tasks) {
      total += task.estimateHours * vels[Math.floor(rand() * vels.length)]!;
    }
    totals.push(total);
  }

  totals.sort((left, right) => left - right);
  const expectedHours = totals.reduce((sum, total) => sum + total, 0) / totals.length;

  return {
    expectedHours: roundTwo(expectedHours),
    p50: roundTwo(percentile(totals, 0.5)),
    p80: roundTwo(percentile(totals, 0.8)),
    p95: roundTwo(percentile(totals, 0.95)),
    iterations,
    calibrated,
  };
}
