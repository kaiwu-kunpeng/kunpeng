import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ActionLevel, EvidenceKind } from "./types.js";

export interface OpsAction {
  at: number;
  loopId: string;
  projectId: string;
  recipe: string;
  lever: string;
  subject: string;
  metricKey: string;
  metricAfter: number;
  metricDelta: number;
  verified: boolean;
  level?: ActionLevel;
  goalId?: string;
  outboxId?: string;
  evidence?: string;
  evidenceKind?: EvidenceKind;
  instrumentBroken?: boolean;
  commit?: string;
  deploy?: string;
  guardReset?: boolean;
  note?: string;
  skills?: string[];
}

function actionsPath(stateDir: string): string {
  return join(stateDir, "ops", "actions.jsonl");
}

export async function appendAction(stateDir: string, action: OpsAction): Promise<void> {
  await mkdir(join(stateDir, "ops"), { recursive: true });
  await appendFile(actionsPath(stateDir), `${JSON.stringify(action)}\n`, "utf8");
}

export async function readActions(
  stateDir: string,
  opts?: { loopId?: string; projectId?: string; since?: number },
): Promise<OpsAction[]> {
  let contents: string;
  try {
    contents = await readFile(actionsPath(stateDir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const actions: OpsAction[] = [];
  for (const line of contents.split("\n")) {
    if (line.trim() === "") continue;
    try {
      actions.push(JSON.parse(line) as OpsAction);
    } catch {
      // A corrupt JSONL row must not prevent later valid actions from loading.
    }
  }

  return actions
    .filter((action) => opts?.loopId === undefined || action.loopId === opts.loopId)
    .filter((action) => opts?.projectId === undefined || action.projectId === opts.projectId)
    .filter((action) => opts?.since === undefined || action.at >= opts.since)
    .sort((a, b) => a.at - b.at);
}

export function goalProgress(
  current: number,
  goal: { target: number; direction?: "up" | "down" },
): number {
  if (Number.isNaN(current) || Number.isNaN(goal.target)) return 0;

  if (goal.direction === "down") {
    if (current === 0) return 0;
    if (current <= goal.target) return 1;
    return Math.min(1, Math.max(0, goal.target / current));
  }

  if (goal.target === 0) return 0;
  return Math.min(1, Math.max(0, current / goal.target));
}
