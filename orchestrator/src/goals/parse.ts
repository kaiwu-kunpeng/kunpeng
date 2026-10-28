import { isGoalId } from "./store.js";

export function parseGoalId(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*\*\*目标\*\*\s*[:：]?\s*(goal-[a-z0-9-]+)\b/.exec(line)
      ?? /^\s*goal\s*[:：]\s*(goal-[a-z0-9-]+)\b/i.exec(line);
    if (match && isGoalId(match[1])) return match[1];
  }
  return undefined;
}
