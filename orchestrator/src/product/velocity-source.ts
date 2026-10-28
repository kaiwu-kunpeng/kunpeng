import type { FlowState } from "../runtime/flowstate.js";
import { velocityFromHistory } from "./estimate.js";

export interface VelocitySample {
  estimateHours: number;
  actualHours: number;
}

export function flowActualHours(flow: FlowState): number | null {
  if (flow.status !== "verified" || flow.updatedAt <= flow.startedAt) {
    return null;
  }

  return (flow.updatedAt - flow.startedAt) / 3_600_000;
}

export interface VelocityOpts {
  minSamples?: number;
  minActualHours?: number;
  maxActualHours?: number;
  minVelocity?: number;
  maxVelocity?: number;
}

export function velocitiesFromFlows(
  flows: FlowState[],
  baselineHours: number,
  opts?: VelocityOpts,
): number[] {
  const minSamples = opts?.minSamples ?? 3;
  const minH = opts?.minActualHours ?? 0.02;
  const maxH = opts?.maxActualHours ?? 168;
  const minVel = opts?.minVelocity ?? 0.25;
  const maxVel = opts?.maxVelocity ?? 4;

  if (!(baselineHours > 0)) {
    return [];
  }

  const samples: VelocitySample[] = [];
  for (const flow of flows) {
    const h = flowActualHours(flow);
    if (h === null || h < minH || h > maxH) {
      continue;
    }

    samples.push({ estimateHours: baselineHours, actualHours: h });
  }

  const vels = velocityFromHistory(samples);
  const banded = vels.filter((v) => v >= minVel && v <= maxVel);
  return banded.length >= minSamples ? banded : [];
}
