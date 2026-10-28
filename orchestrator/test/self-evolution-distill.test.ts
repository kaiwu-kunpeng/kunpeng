import { expect, test } from "vitest";
import { buildProposal, type ProposedChange } from "../src/loop/self-evolution.js";
import type { Artifact } from "../src/artifacts/types.js";

const exp = (id: string, proposedRuleChange?: unknown): Artifact =>
  ({ kind: "experience", id, status: "draft", body: "", meta: proposedRuleChange ? { sourceFlow: `flow-${id}`, outcome: "verified", proposedRuleChange } : {} });

test("distill extra: conventions accepted, core rejected, provenance isolated", () => {
  const extra: ProposedChange[] = [
    { target: "conventions", text: "prefer deterministic checks", source: "digest:1" },
    { target: "constitution/core.md", text: "weaken single-writer", source: "digest:2" },
  ];
  const p = buildProposal([exp("e1", { target: "conventions", text: "always lint" })], extra);

  // conventions-targeted extra lands in changes
  expect(p.changes.some((c) => c.target === "conventions" && c.source === "digest:1")).toBe(true);
  // core-targeted extra never lands in changes
  expect(p.changes.some((c) => c.target === "constitution/core.md")).toBe(false);
  // core-targeted extra is rejected instead
  expect(p.rejected.some((r) => r.change.target === "constitution/core.md" && r.change.source === "digest:2")).toBe(true);
  // provenance isolation: sourceExperiences only from experiences, not extra
  expect(p.sourceExperiences).toEqual(["e1"]);
});

test("backward compatible: extra omitted yields empty changes for empty experiences", () => {
  expect(buildProposal([]).changes).toEqual([]);
});