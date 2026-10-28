import { describe, expect, test, vi } from "vitest";
import { buildDifferentialEvalDeps } from "../../src/evolution/diff-eval-deps.js";
import { runEvalCurve } from "../../src/evolution/eval-curve.js";
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

describe("buildDifferentialEvalDeps", () => {
  test("forces baseline and candidate cwd for acceptance runs", async () => {
    const listHoldout = vi.fn(async () => [task("one")]);
    const runAcceptance = vi.fn(async (_cmd: string, cwd: string) => {
      if (cwd === "/wt/base") return { passed: false, ms: 10 };
      if (cwd === "/wt/cand") return { passed: true, ms: 20 };
      throw new Error(`unexpected cwd: ${cwd}`);
    });
    const config = {
      listHoldout,
      runAcceptance,
      baselineCwd: "/wt/base",
      candidateCwd: "/wt/cand",
    };

    const deps = buildDifferentialEvalDeps(config);
    const baseline = await deps.runBaseline("npm test", "/whatever");
    const candidate = await deps.runCandidate("npm test", "/whatever");

    expect(runAcceptance).toHaveBeenNthCalledWith(1, "npm test", "/wt/base");
    expect(runAcceptance).toHaveBeenNthCalledWith(2, "npm test", "/wt/cand");
    expect(baseline.passed).toBe(false);
    expect(candidate.passed).toBe(true);
    expect(deps.cwd).toBe("/wt/base");
    expect(deps.listHoldout).toBe(config.listHoldout);
  });

  test("can be consumed by the real eval curve with split baseline and candidate cwd", async () => {
    const holdout = [task("one"), task("two"), task("three")];
    const runAcceptance = vi.fn(async (cmd: string, cwd: string) => {
      if (cwd === "/wt/base") return { passed: cmd === "test one", ms: 10 };
      if (cwd === "/wt/cand") return { passed: true, ms: 20 };
      throw new Error(`unexpected cwd: ${cwd}`);
    });
    const deps = buildDifferentialEvalDeps({
      listHoldout: async () => holdout,
      runAcceptance,
      baselineCwd: "/wt/base",
      candidateCwd: "/wt/cand",
    });

    const { replay, report } = await runEvalCurve(deps);

    expect(replay.delta).toBeGreaterThan(0);
    expect(replay.baselinePassK).toBeCloseTo(1 / 3);
    expect(replay.candidatePassK).toBe(1);
    expect(replay.perTask).toHaveLength(3);
    expect(report.taskCount).toBe(3);
    expect(runAcceptance.mock.calls.filter(([, cwd]) => cwd === "/wt/base")).toHaveLength(6);
    expect(runAcceptance.mock.calls.filter(([, cwd]) => cwd === "/wt/cand")).toHaveLength(6);
    expect(runAcceptance.mock.calls.some(([, cwd]) => cwd === deps.cwd)).toBe(true);
  });
});
