import { resumeFrom, type ResumePlan } from "./idempotent.js";

export const DEV_CYCLE_STAGES = ["spec", "implement", "verify"] as const;

export interface FlowHistory {
  history: { stage: string; at: number }[];
}

export function deriveCompletedStages(state: FlowHistory): string[] {
  const mainStages = new Set<string>(DEV_CYCLE_STAGES);
  const completed = new Set<string>();

  for (const entry of state.history.slice(0, -1)) {
    if (mainStages.has(entry.stage)) completed.add(entry.stage);
  }

  return DEV_CYCLE_STAGES.filter((stage) => completed.has(stage));
}

export function planFlowResume(state: FlowHistory, stages: readonly string[]): ResumePlan {
  return resumeFrom([...stages], deriveCompletedStages(state));
}
