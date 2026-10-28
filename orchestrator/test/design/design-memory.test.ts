import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { DesignMemoryStore, rankAnchors, summarize, tallyWins, type DesignDecision } from "../../src/design/design-memory.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "kunpeng-design-memory-"));
}

test("tallyWins counts wins by bucket and anchor without penalizing losses", () => {
  const out = tallyWins([
    { bucket: "b1", anchor: "Swiss", won: true },
    { bucket: "b1", anchor: "Swiss", won: true },
    { bucket: "b1", anchor: "Organic", won: false },
  ]);

  expect(out["b1"]["Swiss"]).toBe(2);
  expect(out["b1"]["Organic"] ?? 0).toBe(0);
});

test("rankAnchors orders candidates by bucket wins and preserves stable order for ties", () => {
  const history: DesignDecision[] = [
    { bucket: "b1", anchor: "Swiss", won: true },
    { bucket: "b1", anchor: "Swiss", won: true },
    { bucket: "b1", anchor: "Brutalist", won: true },
    { bucket: "b2", anchor: "Organic", won: true },
  ];
  const anchors = ["Organic", "Brutalist", "Swiss"];

  expect(rankAnchors(history, "b1", anchors)).toEqual(["Swiss", "Brutalist", "Organic"]);
  expect(anchors).toEqual(["Organic", "Brutalist", "Swiss"]);
});

test("summarize groups decisions by bucket and anchor sorted by win rate then total", () => {
  const stats = summarize([
    { bucket: "b", anchor: "Swiss", won: true },
    { bucket: "b", anchor: "Swiss", won: false },
    { bucket: "b", anchor: "Organic", won: true },
  ]);

  expect(stats).toEqual([
    { bucket: "b", anchor: "Organic", won: 1, total: 1, winRate: 1 },
    { bucket: "b", anchor: "Swiss", won: 1, total: 2, winRate: 0.5 },
  ]);
});

test("summarize returns an empty list for empty history", () => {
  expect(summarize([])).toEqual([]);
});

test("DesignMemoryStore appends JSONL records and skips bad JSON lines on load", () => {
  const dir = tempDir();
  const store = new DesignMemoryStore(dir);

  store.append({ bucket: "b1", anchor: "Swiss", won: true, at: 1 });
  store.append({ bucket: "b1", anchor: "Organic", won: false, at: 2 });

  expect(store.loadAll()).toEqual([
    { bucket: "b1", anchor: "Swiss", won: true, at: 1 },
    { bucket: "b1", anchor: "Organic", won: false, at: 2 },
  ]);

  appendFileSync(join(dir, "decisions.jsonl"), "{bad\n", "utf8");

  expect(store.loadAll()).toEqual([
    { bucket: "b1", anchor: "Swiss", won: true, at: 1 },
    { bucket: "b1", anchor: "Organic", won: false, at: 2 },
  ]);
});

test("DesignMemoryStore returns an empty list for a directory without a ledger", () => {
  const store = new DesignMemoryStore(tempDir());

  expect(store.loadAll()).toEqual([]);
});
