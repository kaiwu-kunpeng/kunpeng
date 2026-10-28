import { describe, expect, test, vi } from "vitest";
import { replayHoldout } from "../../src/evolution/eval-replay.js";
import type { DifferentialEvalDeps } from "../../src/evolution/eval-runner.js";
import type { RegressionTask } from "../../src/evolution/regression-store.js";

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

describe("replayHoldout", () => {
  test("records per-task replay and positive differential when candidate improves holdout", async () => {
    const tasks = [task("one"), task("two"), task("three")];
    const baselineResults = [
      { passed: true, ms: 5 },
      { passed: false, ms: 5 },
      { passed: false, ms: 5 },
      { passed: true, ms: 5 },
      { passed: false, ms: 5 },
      { passed: false, ms: 5 },
    ];
    const runBaseline = vi.fn(async () => baselineResults.shift() ?? { passed: false, ms: 5 });
    const runCandidate = vi.fn(async () => ({ passed: true, ms: 12 }));

    const result = await replayHoldout(deps({
      listHoldout: async () => tasks,
      runBaseline,
      runCandidate,
    }));

    expect(result.perTask).toHaveLength(3);
    expect(result.perTask.map((entry) => entry.taskId)).toEqual(["one", "two", "three"]);
    expect(result.perTask[0]).toEqual({
      taskId: "one",
      baselinePassed: true,
      candidatePassed: true,
      ms: 12,
      iterations: 1,
      baselinePassCount: 1,
      candidatePassCount: 1,
      unstable: false,
    });
    expect(result.perTask[1]).toEqual({
      taskId: "two",
      baselinePassed: false,
      candidatePassed: true,
      ms: 12,
      iterations: 1,
      baselinePassCount: 0,
      candidatePassCount: 1,
      unstable: false,
    });
    expect(result.perTask[2]).toEqual({
      taskId: "three",
      baselinePassed: false,
      candidatePassed: true,
      ms: 12,
      iterations: 1,
      baselinePassCount: 0,
      candidatePassCount: 1,
      unstable: false,
    });
    expect(result.unstableTaskIds).toEqual([]);
    expect(result.baselinePassK).toBeCloseTo(1 / 3);
    expect(result.candidatePassK).toBeCloseTo(1);
    expect(result.delta).toBeCloseTo(1 - 1 / 3);
    expect(result.delta).toBeGreaterThan(0);
    expect(result.costPerResolvedTask).toBeGreaterThan(0);
    expect(runBaseline).toHaveBeenCalledTimes(6);
    expect(runCandidate).toHaveBeenCalledTimes(6);
    for (const [index, holdoutTask] of tasks.entries()) {
      expect(runBaseline).toHaveBeenNthCalledWith(index + 1, holdoutTask.acceptanceCmd, "/fake/cwd");
      expect(runCandidate).toHaveBeenNthCalledWith(index + 1, holdoutTask.acceptanceCmd, "/fake/cwd");
      expect(runBaseline).toHaveBeenNthCalledWith(index + 4, holdoutTask.acceptanceCmd, "/fake/cwd");
      expect(runCandidate).toHaveBeenNthCalledWith(index + 4, holdoutTask.acceptanceCmd, "/fake/cwd");
    }
  });

  test("reports negative differential and per-task regressions when candidate gets worse", async () => {
    const candidateResults = [
      { passed: true, ms: 8 },
      { passed: false, ms: 8 },
      { passed: false, ms: 8 },
      { passed: true, ms: 8 },
      { passed: false, ms: 8 },
      { passed: false, ms: 8 },
    ];
    const runBaseline = vi.fn(async () => ({ passed: true, ms: 8 }));
    const runCandidate = vi.fn(async () => candidateResults.shift() ?? { passed: false, ms: 8 });

    const result = await replayHoldout(deps({
      listHoldout: async () => [task("one"), task("two"), task("three")],
      runBaseline,
      runCandidate,
    }));

    expect(result.candidatePassK).toBeLessThan(result.baselinePassK);
    expect(result.delta).toBeLessThan(0);
    expect(result.perTask.some((entry) => entry.baselinePassed && !entry.candidatePassed)).toBe(true);
  });

  test("returns zero replay result for empty holdout without throwing", async () => {
    await expect(replayHoldout(deps({
      listHoldout: async () => [],
    }))).resolves.toEqual({
      perTask: [],
      baselinePassK: 0,
      candidatePassK: 0,
      delta: 0,
      pairedDelta: 0,
      pairedStdError: 0,
      discernible: false,
      costPerResolvedTask: 0,
      unstableTaskIds: [],
    });
  });
});