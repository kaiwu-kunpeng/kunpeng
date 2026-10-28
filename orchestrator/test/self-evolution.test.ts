import { expect, test } from "vitest";
import { buildProposal } from "../src/loop/self-evolution.js";
import type { Artifact } from "../src/artifacts/types.js";

const exp = (id: string, proposedRuleChange?: unknown): Artifact =>
  ({ kind: "experience", id, status: "draft", body: "", meta: proposedRuleChange ? { sourceFlow: `flow-${id}`, outcome: "verified", proposedRuleChange } : {} });

test("conventions-targeted change is accepted with provenance", () => {
  const p = buildProposal([exp("e1", { target: "conventions", text: "always run lint before commit" })]);
  expect(p.changes).toHaveLength(1);
  expect(p.changes[0].target).toBe("conventions");
  expect(p.changes[0].source).toBe("e1");   // per-change provenance
  expect(p.sourceExperiences).toContain("e1");
  expect(p.rejected).toHaveLength(0);
});

test("core-targeted change is REJECTED (immutable core, C6 guardrail 1)", () => {
  const p = buildProposal([exp("e2", { target: "constitution/core.md", text: "drop single-writer rule" })]);
  expect(p.changes).toHaveLength(0);
  expect(p.rejected).toHaveLength(1);
  expect(p.rejected[0].reason).toMatch(/核心|core/i);
});

test("experiences without a proposed change are ignored", () => {
  const p = buildProposal([exp("e3"), exp("e4", { target: "conventions", text: "x" })]);
  expect(p.sourceExperiences).toEqual(["e4"]);
  expect(p.changes).toHaveLength(1);
});