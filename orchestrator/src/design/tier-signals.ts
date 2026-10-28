import type { AxeViolation } from "../verify/a11y-summary.js";
import { summarizeAxe } from "../verify/a11y-summary.js";
import { decideVisual } from "../verify/visual-decision.js";
import type { TierGateInput } from "../verify/tier-gate.js";
import { decidePerf, type PerfMetrics } from "./perf-budget.js";

export type ProbeTarget = { html?: string; url?: string };

export interface RawTierSignals {
  axeViolations: AxeViolation[];
  perfMetrics: PerfMetrics;
  visualDiff?: { diffPixels: number; totalPixels: number };
  baselineChanged?: boolean;
  antiPatternHits?: { id: string; rule: string }[];
}

/**
 * Browser-backed probes will run Lighthouse, axe, and pixel comparisons as
 * browser/agent I/O in a later increment. This file only defines the boundary,
 * fake implementation, and pure aggregation, following the ScreenshotCapturer
 * split between pluggable I/O implementations and deterministic callers.
 */
export interface TierSignalProbe {
  probe(target: ProbeTarget): Promise<RawTierSignals>;
}

export class FakeTierProbe implements TierSignalProbe {
  constructor(private canned: Partial<RawTierSignals> = {}) {}

  async probe(target: ProbeTarget): Promise<RawTierSignals> {
    void target;
    return {
      axeViolations: [],
      perfMetrics: { lcpMs: 1000, cls: 0.01, tbtMs: 50, totalBytes: 500_000 },
      ...this.canned,
    };
  }
}

export function aggregateTierSignals(
  raw: RawTierSignals,
  upstream: { buildPassed: boolean; behaviorPassed: boolean },
): TierGateInput {
  const a11yGateable = summarizeAxe(raw.axeViolations).gateable;
  const perfWithinBudget = decidePerf(raw.perfMetrics).withinBudget;
  const visualMatchesBaseline = raw.visualDiff
    ? decideVisual(raw.visualDiff.diffPixels, raw.visualDiff.totalPixels).withinTolerance
    : true;
  const hasNewOrChangedBaseline = raw.visualDiff ? raw.baselineChanged === true : true;

  return {
    buildPassed: upstream.buildPassed,
    behaviorPassed: upstream.behaviorPassed,
    a11yGateable,
    perfWithinBudget,
    visualMatchesBaseline,
    hasNewOrChangedBaseline,
  };
}
