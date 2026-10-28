import * as fs from "node:fs";
import { join } from "node:path";

export interface DesignDecision {
  bucket: string;
  anchor: string;
  won: boolean;
  at?: number;
}

export interface AnchorStat {
  bucket: string;
  anchor: string;
  won: number;
  total: number;
  winRate: number;
}

export function tallyWins(history: DesignDecision[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};

  for (const decision of history) {
    if (!decision.won) continue;
    out[decision.bucket] ??= {};
    out[decision.bucket][decision.anchor] = (out[decision.bucket][decision.anchor] ?? 0) + 1;
  }

  return out;
}

export function summarize(history: DesignDecision[]): AnchorStat[] {
  const stats = new Map<string, AnchorStat>();

  for (const decision of history) {
    const key = `${decision.bucket}\u0000${decision.anchor}`;
    const stat = stats.get(key) ?? {
      bucket: decision.bucket,
      anchor: decision.anchor,
      won: 0,
      total: 0,
      winRate: 0,
    };

    stat.total += 1;
    if (decision.won) stat.won += 1;
    stat.winRate = stat.total > 0 ? stat.won / stat.total : 0;
    stats.set(key, stat);
  }

  return Array.from(stats.values()).sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    return b.total - a.total;
  });
}

export function rankAnchors(history: DesignDecision[], bucket: string, anchors: string[]): string[] {
  const wins = tallyWins(history)[bucket] ?? {};

  return anchors
    .map((anchor, index) => ({ anchor, index, wins: wins[anchor] ?? 0 }))
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return a.index - b.index;
    })
    .map((entry) => entry.anchor);
}

function isDesignDecision(value: unknown): value is DesignDecision {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.bucket === "string" && typeof record.anchor === "string" && typeof record.won === "boolean";
}

export class DesignMemoryStore {
  constructor(private dir: string) {}

  private file(): string {
    return join(this.dir, "decisions.jsonl");
  }

  append(d: DesignDecision): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.appendFileSync(this.file(), `${JSON.stringify(d)}\n`, "utf8");
  }

  loadAll(): DesignDecision[] {
    const file = this.file();
    if (!fs.existsSync(file)) return [];

    const decisions: DesignDecision[] = [];
    const lines = fs.readFileSync(file, "utf8").split("\n");

    for (const line of lines) {
      if (line.trim() === "") continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (isDesignDecision(parsed)) decisions.push(parsed);
      } catch {
        // Bad JSONL rows are ignored so one corrupt line does not poison the ledger.
      }
    }

    return decisions;
  }
}
