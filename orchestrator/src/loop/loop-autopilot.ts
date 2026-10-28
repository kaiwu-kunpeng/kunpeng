import type { LoopDef } from "./types.js";

export interface LoopAutopilotStep { lever: string; target?: string; }

export interface LoopAutopilotWaveOutcome {
  step: LoopAutopilotStep;
  verified: boolean;
  metricDelta?: number;
  detail?: string;
  error?: string;
}

export type LoopAutopilotStopReason =
  | "budget" | "no-next-step" | "wave-failed" | "gated" | "quota" | "error" | "loop-missing" | "stopped";

export interface LoopAutopilotResult {
  loopId: string;
  waves: LoopAutopilotWaveOutcome[];
  stopReason: LoopAutopilotStopReason;
}

export interface LoopAutopilotDeps {
  loopId: string;
  maxWaves: number;
  readLoop: () => Promise<LoopDef | null>;
  pickNext: (loop: LoopDef) => Promise<LoopAutopilotStep | null> | LoopAutopilotStep | null;
  setNext: (step: LoopAutopilotStep) => Promise<void>;
  driveWave: () => Promise<{ gated: boolean; verified: boolean; metricDelta?: number; detail?: string }>;
  onCheckpoint?: () => Promise<boolean> | boolean;
}

export function pickNextTarget(targets: string[], loop: LoopDef, lever: string): LoopAutopilotStep | null {
  for (const target of targets) {
    const done = loop.waves.some((wave) => wave.subject === target && wave.verified);
    if (!done) return { lever, target };
  }
  return null;
}

export async function runLoopAutopilot(deps: LoopAutopilotDeps): Promise<LoopAutopilotResult> {
  const waves: LoopAutopilotWaveOutcome[] = [];
  let stopReason: LoopAutopilotStopReason = "budget";

  while (waves.length < deps.maxWaves) {
    if (deps.onCheckpoint && (await deps.onCheckpoint())) {
      stopReason = "stopped";
      break;
    }

    const loop = await deps.readLoop();
    if (!loop) {
      stopReason = "loop-missing";
      break;
    }

    const step = await deps.pickNext(loop);
    if (!step) {
      stopReason = "no-next-step";
      break;
    }

    await deps.setNext(step);

    try {
      const result = await deps.driveWave();
      if (result.gated) {
        waves.push({ step, verified: false, detail: "gated" });
        stopReason = "gated";
        break;
      }

      waves.push({
        step,
        verified: result.verified,
        ...(result.metricDelta !== undefined ? { metricDelta: result.metricDelta } : {}),
        ...(result.detail ? { detail: result.detail } : {}),
      });
      if (!result.verified) {
        stopReason = "wave-failed";
        break;
      }
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      waves.push({ step, verified: false, error: message });
      stopReason = /quota/i.test(message) ? "quota" : "error";
      break;
    }
  }

  return { loopId: deps.loopId, waves, stopReason };
}
