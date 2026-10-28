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

/** 按序列返回结果的假运行器；耗尽后重复最后一个。 */
function seq(results: { passed: boolean; ms: number }[]) {
  let i = 0;
  return vi.fn(async () => results[Math.min(i++, results.length - 1)]);
}

describe("replayHoldout 的迭代与不稳定检测", () => {
  test("iterations=3 时 baseline 与 candidate 各被调用三次", async () => {
    const runBaseline = seq([{ passed: true, ms: 1 }]);
    const runCandidate = seq([{ passed: true, ms: 2 }]);
    await replayHoldout(
      deps({ listHoldout: async () => [task("one")], runBaseline, runCandidate }),
      { iterations: 3 },
    );
    // 3 次来自 replayHoldout 的迭代，1 次来自 evaluateProposalDifferential
    expect(runBaseline.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(runCandidate.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  test("三次全过：passCount=3、passed=true、unstable=false", async () => {
    const r = await replayHoldout(
      deps({
        listHoldout: async () => [task("one")],
        runBaseline: seq([{ passed: true, ms: 1 }]),
        runCandidate: seq([{ passed: true, ms: 2 }]),
      }),
      { iterations: 3 },
    );
    expect(r.perTask[0].iterations).toBe(3);
    expect(r.perTask[0].candidatePassCount).toBe(3);
    expect(r.perTask[0].candidatePassed).toBe(true);
    expect(r.perTask[0].unstable).toBe(false);
    expect(r.unstableTaskIds).toEqual([]);
  });

  test("三次全挂：passCount=0、passed=false、unstable=false", async () => {
    const r = await replayHoldout(
      deps({
        listHoldout: async () => [task("one")],
        runBaseline: seq([{ passed: false, ms: 1 }]),
        runCandidate: seq([{ passed: false, ms: 2 }]),
      }),
      { iterations: 3 },
    );
    expect(r.perTask[0].candidatePassCount).toBe(0);
    expect(r.perTask[0].candidatePassed).toBe(false);
    expect(r.perTask[0].unstable).toBe(false);
  });

  test("三次里过两次：严格多数判 true，且标记 unstable", async () => {
    const r = await replayHoldout(
      deps({
        listHoldout: async () => [task("flaky")],
        runBaseline: seq([{ passed: true, ms: 1 }]),
        runCandidate: seq([
          { passed: true, ms: 2 },
          { passed: false, ms: 2 },
          { passed: true, ms: 2 },
        ]),
      }),
      { iterations: 3 },
    );
    expect(r.perTask[0].candidatePassCount).toBe(2);
    expect(r.perTask[0].candidatePassed).toBe(true);
    expect(r.perTask[0].unstable).toBe(true);
    expect(r.unstableTaskIds).toEqual(["flaky"]);
  });

  test("三次里过一次：判 false 且仍标记 unstable", async () => {
    const r = await replayHoldout(
      deps({
        listHoldout: async () => [task("flaky")],
        runBaseline: seq([{ passed: true, ms: 1 }]),
        runCandidate: seq([
          { passed: false, ms: 2 },
          { passed: true, ms: 2 },
          { passed: false, ms: 2 },
        ]),
      }),
      { iterations: 3 },
    );
    expect(r.perTask[0].candidatePassCount).toBe(1);
    expect(r.perTask[0].candidatePassed).toBe(false);
    expect(r.perTask[0].unstable).toBe(true);
  });

  test("baseline 侧翻转也算 unstable", async () => {
    const r = await replayHoldout(
      deps({
        listHoldout: async () => [task("b-flaky")],
        runBaseline: seq([
          { passed: true, ms: 1 },
          { passed: false, ms: 1 },
          { passed: true, ms: 1 },
        ]),
        runCandidate: seq([{ passed: true, ms: 2 }]),
      }),
      { iterations: 3 },
    );
    expect(r.perTask[0].baselinePassCount).toBe(2);
    expect(r.perTask[0].unstable).toBe(true);
  });

  test("iterations 为 0 或负数按 1 处理", async () => {
    for (const iterations of [0, -5]) {
      const r = await replayHoldout(
        deps({
          listHoldout: async () => [task("one")],
          runBaseline: seq([{ passed: true, ms: 1 }]),
          runCandidate: seq([{ passed: true, ms: 2 }]),
        }),
        { iterations },
      );
      expect(r.perTask[0].iterations).toBe(1);
    }
  });

  test("空 holdout 返回含 unstableTaskIds 且不抛", async () => {
    await expect(replayHoldout(deps({ listHoldout: async () => [] }), { iterations: 3 })).resolves
      .toEqual({
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