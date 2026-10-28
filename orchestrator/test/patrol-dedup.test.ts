import { expect, test } from "vitest";
import { changeKey, collectPendingKeys, dedupeChanges } from "../src/loop/patrol-dedup.js";
import type { ProposedChange } from "../src/loop/self-evolution.js";
import type { Artifact } from "../src/artifacts/types.js";

const chg = (target: string, text: string, source = "s"): ProposedChange => ({ target, text, source });

const proposalArt = (id: string, changes: ProposedChange[]): Artifact =>
  ({ kind: "proposal", id, status: "draft", body: "", meta: { proposal: { changes } } });

test("changeKey is target+\\n+text, ignores source", () => {
  expect(changeKey(chg("conventions", "run lint", "e1"))).toBe("conventions\nrun lint");
  expect(changeKey(chg("conventions", "run lint", "e1"))).toBe(changeKey(chg("conventions", "run lint", "e2")));
});

test("collectPendingKeys gathers keys defensively, skipping malformed meta", () => {
  const existing = chg("conventions", "already here");
  const pending: Artifact[] = [
    proposalArt("p1", [existing]),
    { kind: "proposal", id: "p2", status: "draft", body: "", meta: {} },
  ];
  const keys = collectPendingKeys(pending);
  expect(keys.size).toBe(1);
  expect(keys.has(changeKey(existing))).toBe(true);
});

test("dedupeChanges splits by pending keys and within-batch duplicates, preserving order", () => {
  const existing = chg("conventions", "已存在");
  const pendingKeys = new Set<string>([changeKey(existing)]);
  const input: ProposedChange[] = [chg("conventions", "已存在"), chg("conventions", "新的"), chg("conventions", "新的")];
  const { fresh, duplicate } = dedupeChanges(input, pendingKeys);
  expect(fresh.map((c) => c.text)).toEqual(["新的"]);
  expect(duplicate.length).toBe(2);
});
