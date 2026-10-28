import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type TranscriptEntry = { seq: number; ts: number; kind: string; data: unknown };

export interface WorkspaceTranscript {
  /** 追加一条,返回带 seq(从 1 递增,按 workspace 独立)的条目;同时落盘 jsonl。 */
  append(workspaceId: string, kind: string, data: unknown): TranscriptEntry;
  /** 取该 workspace 的条目;给 sinceSeq 时只返回 seq > sinceSeq 的。 */
  get(workspaceId: string, sinceSeq?: number): TranscriptEntry[];
}

/** dir 下每 workspace 一个 <id>.jsonl(追加写);内存维护 seq。ts 用 Date.now()。 */
export function createWorkspaceTranscript(dir: string): WorkspaceTranscript {
  mkdirSync(dir, { recursive: true });
  const entriesByWorkspace = new Map<string, TranscriptEntry[]>();

  const ensureEntries = (workspaceId: string): TranscriptEntry[] => {
    const existing = entriesByWorkspace.get(workspaceId);
    if (existing) return existing;
    const created: TranscriptEntry[] = [];
    entriesByWorkspace.set(workspaceId, created);
    return created;
  };

  return {
    append(workspaceId: string, kind: string, data: unknown): TranscriptEntry {
      const entries = ensureEntries(workspaceId);
      const entry: TranscriptEntry = {
        seq: entries.length + 1,
        ts: Date.now(),
        kind,
        data,
      };
      entries.push(entry);
      appendFileSync(join(dir, `${workspaceId}.jsonl`), `${JSON.stringify(entry)}\n`);
      return entry;
    },
    get(workspaceId: string, sinceSeq?: number): TranscriptEntry[] {
      const entries = ensureEntries(workspaceId);
      if (sinceSeq == null) return [...entries];
      return entries.filter((entry) => entry.seq > sinceSeq);
    },
  };
}
