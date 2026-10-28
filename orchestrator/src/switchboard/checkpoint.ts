import { checkStopSignal as checkDetailedStopSignal } from "./signal.js";
import type { SwitchDeps, SwitchboardStore } from "./store.js";

export interface CheckpointStopSignalResult {
  halt: boolean;
  acked: string[];
}

export async function checkStopSignal(
  store: SwitchboardStore,
  me: string,
  deps: SwitchDeps,
): Promise<CheckpointStopSignalResult> {
  const result = await checkDetailedStopSignal(store, me, deps);
  return {
    halt: result.stopped,
    acked: result.stops.map((stop) => stop.id),
  };
}
