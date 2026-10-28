import { describe, expect, test } from "vitest";
import { evidenceFromAgentDifferential } from "../../src/evolution/eval-evidence.js";
import type { ReplayResult } from "../../src/evolution/eval-report.js";
import { hasApplicableEvidence } from "../../src/loop/self-evolution.js";

describe("evidenceFromAgentDifferential", () => {
  test("maps agent differential replay fields to proposal evidence", () => {
    const replay: ReplayResult = {
      baselinePassK: 1 / 3,
      candidatePassK: 1,
      costPerResolvedTask: 20,
      tasks: [],
      measuredAt: 1000,
    };

    const evidence = evidenceFromAgentDifferential(replay);

    expect(evidence.holdoutPassK).toBe(1);
    expect(evidence.baseline?.holdoutPassK).toBe(1 / 3);
    expect(evidence.costPerResolvedTask).toBe(20);
    expect(evidence.measuredAt).toBe(1000);
  });

  test("produces evidence accepted by the proposal evidence gate", () => {
    const replay: ReplayResult = {
      baselinePassK: 1 / 3,
      candidatePassK: 1,
      costPerResolvedTask: 20,
      tasks: [],
      measuredAt: 1000,
    };

    expect(hasApplicableEvidence(evidenceFromAgentDifferential(replay))).toBe(true);
  });

  test("keeps regressed replay evidence rejected by the proposal evidence gate", () => {
    const replay: ReplayResult = {
      baselinePassK: 0.5,
      candidatePassK: 0.2,
      costPerResolvedTask: 20,
      tasks: [],
    };

    expect(hasApplicableEvidence(evidenceFromAgentDifferential(replay))).toBe(false);
  });
});
