import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";

export interface EventLoopLag {
  meanMs: number;
  p99Ms: number;
  maxMs: number;
}

type EventLoopDelaySnapshot = {
  mean: number;
  max: number;
  percentile: (p: number) => number;
};

let histogram: IntervalHistogram | undefined;

function nsToMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value / 1_000_000) * 100) / 100;
}

export function summarizeEventLoopDelay(h: EventLoopDelaySnapshot): EventLoopLag {
  return {
    meanMs: nsToMs(h.mean),
    p99Ms: nsToMs(h.percentile(99)),
    maxMs: nsToMs(h.max),
  };
}

export function eventLoopLag(): EventLoopLag {
  if (!histogram) {
    histogram = monitorEventLoopDelay({ resolution: 20 });
    histogram.enable();
  }
  return summarizeEventLoopDelay(histogram);
}
