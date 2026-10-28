import { describe, expect, test, vi } from "vitest";
import { runEvalCurve } from "../../src/evolution/eval-curve.js";
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

describe("runEvalCurve", () => {
  test("runs holdout replay and renders an improved report with acceptance commands restored by id", async () => {
    const holdout = [task("one"), task("two"), task("three")];
    const listHoldout = vi.fn(async () => holdout);
    const runBaseline = vi.fn(async (cmd: string) => ({
      passed: cmd === "test one",
      ms: 5,
    }));
    const runCandidate = vi.fn(async () => ({ passed: true, ms: 12 }));

    const { replay, report } = await runEvalCurve(deps({
      listHoldout,
      runBaseline,
      runCandidate,
    }));

    expect(replay.baselinePassK).toBeCloseTo(1 / 3);
    expect(replay.candidatePassK).toBeCloseTo(1);
    expect(replay.delta).toBeGreaterThan(0);
    expect(report.baselinePassK).toBe(replay.baselinePassK);
    expect(report.candidatePassK).toBe(replay.candidatePassK);
    expect(report.taskCount).toBe(3);
    expect(report.passedCount).toBe(3);
    expect(report.markdown).toContain("test one");
    expect(report.markdown).toContain("test two");
    expect(report.markdown).toContain("test three");
    expect(listHoldout).toHaveBeenCalledTimes(3);
    expect(runBaseline).toHaveBeenCalledTimes(6);
    expect(runCandidate).toHaveBeenCalledTimes(6);
  });

  test("renders an empty report when holdout is empty", async () => {
    const { replay, report } = await runEvalCurve(deps({
      listHoldout: async () => [],
    }));

    expect(replay.perTask).toEqual([]);
    expect(report.taskCount).toBe(0);
    expect(report.passedCount).toBe(0);
    expect(report.baselinePassK).toBe(0);
    expect(report.candidatePassK).toBe(0);
    expect(report.markdown).toContain("（无任务明细：holdout 为空）");
  });

  test("passes report meta through to rendered markdown", async () => {
    const { report } = await runEvalCurve(deps({
      listHoldout: async () => [],
    }), {
      proposalId: "proposal-123",
      proposalTitle: "曲线接线",
      repeatCmd: "cd orchestrator && npm run eval:curve -- proposal-123",
      generatedAt: 98765,
    });

    expect(report.markdown).toContain("proposal-123");
    expect(report.markdown).toContain("曲线接线");
    expect(report.markdown).toContain("cd orchestrator && npm run eval:curve -- proposal-123");
    expect(report.markdown).toContain("98765");
  });
});
