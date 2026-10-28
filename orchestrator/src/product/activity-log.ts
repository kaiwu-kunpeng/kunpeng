import { mkdir, readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { productLoopDir } from "./loop-store.js";

export interface ProductActivityEvent {
  ts: number;
  actor: string;
  kind: string;
  summary: string;
  stage?: string;
  cost?: number;
}

function activityPath(repoRoot: string, slug: string): string {
  return join(productLoopDir(repoRoot, slug), "activity.jsonl");
}

export async function appendActivity(repoRoot: string, slug: string, event: ProductActivityEvent): Promise<void> {
  await mkdir(productLoopDir(repoRoot, slug), { recursive: true });
  await appendFile(activityPath(repoRoot, slug), `${JSON.stringify(event)}\n`, "utf8");
}

export async function readActivity(repoRoot: string, slug: string, limit = 50): Promise<ProductActivityEvent[]> {
  let text: string;
  try {
    text = await readFile(activityPath(repoRoot, slug), "utf8");
  } catch {
    return [];
  }

  const events: ProductActivityEvent[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      events.push(JSON.parse(line) as ProductActivityEvent);
    } catch {
      continue;
    }
  }

  return events.reverse().slice(0, limit);
}
