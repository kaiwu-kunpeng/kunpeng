import { describe, expect, test, vi } from "vitest";
import { evaluateProposalDifferential, type DifferentialEvalDeps } from "../src/evolution/eval-runner.js";
import type { RegressionTask } from "../src/evolution/regression-store.js";

function task(id: string): RegressionTask {
  return {
    id,
    requirement: `requirement ${id}`,
    acceptanceCmd: `test ${id}`,
    sourceFlow: id,
    set: "holdout",
    createdAt: 12345,
  };
}

function deps(overrides: Partial<DifferentialEvalDeps>): DifferentialEvalDeps {
  return {
    listHoldout: async () => [],
    runBaseline: async () => ({ passed: false, ms: 0 }),
    runCandidate: async () => ({ passed: false, ms: 0 }),
    cwd: "/fake/cwd",
    ...overrides,
  };
}

describe("evaluateProposalDifferential", () => {
  test("reports positive differential when candidate passes more holdout tasks than baseline", async () => {
    const baselineResults = [
      { passed: true, ms: 5 },
      { passed: false, ms: 5 },
      { passed: false, ms: 5 },
    ];
    const runBaseline = vi.fn(async () => baselineResults.shift() ?? { passed: false, ms: 0 });
    const runCandidate = vi.fn(async () => ({ passed: true, ms: 12 }));

    const evidence = await evaluateProposalDifferential(deps({
      listHoldout: async () => [task("one"), task("two"), task("three")],
      runBaseline,
      runCandidate,
    }));

    expect(evidence.baseline?.holdoutPassK).toBeCloseTo(1 / 3);
    expect(evidence.holdoutPassK).toBeCloseTo(1);
    expect(evidence.holdoutPassK).toBeGreaterThan(evidence.baseline?.holdoutPassK ?? 0);
    expect(evidence.costPerResolvedTask).toBeGreaterThan(0);
    expect(runBaseline).toHaveBeenNthCalledWith(1, "test one", "/fake/cwd");
    expect(runCandidate).toHaveBeenNthCalledWith(1, "test one", "/fake/cwd");
  });

  test("reports negative differential when candidate passes fewer holdout tasks than baseline", async () => {
    const candidateResults = [
      { passed: true, ms: 8 },
      { passed: false, ms: 8 },
      { passed: false, ms: 8 },
    ];
    const runBaseline = vi.fn(async () => ({ passed: true, ms: 8 }));
    const runCandidate = vi.fn(async () => candidateResults.shift() ?? { passed: false, ms: 0 });

    const evidence = await evaluateProposalDifferential(deps({
      listHoldout: async () => [task("one"), task("two"), task("three")],
      runBaseline,
      runCandidate,
    }));

    expect(evidence.holdoutPassK).toBeLessThan(evidence.baseline?.holdoutPassK ?? 0);
  });

  test("returns zero evidence for empty holdout without throwing", async () => {
    const runBaseline = vi.fn(async () => ({ passed: true, ms: 10 }));
    const runCandidate = vi.fn(async () => ({ passed: true, ms: 10 }));

    const evidence = await evaluateProposalDifferential(deps({
      listHoldout: async () => [],
      runBaseline,
      runCandidate,
    }));

    expect(evidence.holdoutPassK).toBe(0);
    expect(evidence.baseline?.holdoutPassK).toBe(0);
    expect(evidence.costPerResolvedTask).toBe(0);
    expect(runBaseline).toHaveBeenCalledTimes(0);
    expect(runCandidate).toHaveBeenCalledTimes(0);
  });
});
