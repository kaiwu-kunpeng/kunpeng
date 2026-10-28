import { describe, expect, test, vi } from "vitest";
import { evaluateHoldoutReliability, type EvalDeps } from "../src/evolution/eval-runner.js";
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

function deps(overrides: Partial<EvalDeps>): EvalDeps {
  return {
    listHoldout: async () => [],
    runAcceptance: async () => ({ passed: true, ms: 0 }),
    cwd: "/fake/cwd",
    now: () => 999,
    ...overrides,
  };
}

describe("evaluateHoldoutReliability", () => {
  test("reports full reliability and injected measuredAt when all holdout tasks pass", async () => {
    const runAcceptance = vi.fn(async () => ({ passed: true, ms: 10 }));

    const evidence = await evaluateHoldoutReliability(deps({
      listHoldout: async () => [task("one"), task("two"), task("three")],
      runAcceptance,
      now: () => 4242,
    }));

    expect(evidence.holdoutPassK).toBe(1);
    expect(evidence.baseline?.holdoutPassK).toBe(1);
    expect(evidence.costPerResolvedTask).toBe(10);
    expect(evidence.measuredAt).toBe(4242);
  });

  test("counts failed tasks in reliability while averaging total ms over passed tasks", async () => {
    const results = [
      { passed: true, ms: 10 },
      { passed: false, ms: 10 },
      { passed: true, ms: 10 },
    ];
    const runAcceptance = vi.fn(async () => results.shift() ?? { passed: false, ms: 0 });

    const evidence = await evaluateHoldoutReliability(deps({
      listHoldout: async () => [task("one"), task("two"), task("three")],
      runAcceptance,
    }));

    expect(evidence.holdoutPassK).toBe(2 / 3);
    expect(evidence.costPerResolvedTask).toBe(10);
  });

  test("returns zero evidence for empty holdout and does not run acceptance", async () => {
    const runAcceptance = vi.fn(async () => ({ passed: true, ms: 10 }));

    const evidence = await evaluateHoldoutReliability(deps({
      listHoldout: async () => [],
      runAcceptance,
    }));

    expect(evidence.holdoutPassK).toBe(0);
    expect(evidence.baseline?.holdoutPassK).toBe(0);
    expect(runAcceptance).toHaveBeenCalledTimes(0);
  });

  test("returns zero cost when every holdout task fails", async () => {
    const runAcceptance = vi.fn(async () => ({ passed: false, ms: 10 }));

    const evidence = await evaluateHoldoutReliability(deps({
      listHoldout: async () => [task("one"), task("two"), task("three")],
      runAcceptance,
    }));

    expect(evidence.costPerResolvedTask).toBe(0);
    expect(Number.isFinite(evidence.costPerResolvedTask)).toBe(true);
  });
});
