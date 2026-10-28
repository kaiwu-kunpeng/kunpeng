import { describe, expect, test, vi } from "vitest";
import { runAgentDifferential, type AgentAttempt } from "../../src/evolution/agent-differential.js";
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

const baselineCwd = "/tmp/baseline";
const candidateCwd = "/tmp/candidate";
const baselineRules = "baseline rules";
const candidateRules = "candidate rules";
const measuredAt = 999;

function baseConfig(tasks: RegressionTask[]) {
  return {
    tasks,
    baselineCwd,
    candidateCwd,
    baselineRules,
    candidateRules,
    now: () => measuredAt,
  };
}

describe("runAgentDifferential", () => {
  test("records a positive differential and renders the eval report", async () => {
    const tasks = [task("one"), task("two"), task("three")];
    const runAttempt = vi.fn(async (regressionTask: RegressionTask, rules: string): Promise<AgentAttempt> => {
      if (rules === candidateRules) return { passed: true, ms: 30 };
      return { passed: regressionTask.id === "one", ms: 10 };
    });

    const { replay, report } = await runAgentDifferential({
      ...baseConfig(tasks),
      runAttempt,
    });

    expect(replay.measuredAt).toBe(measuredAt);
    expect(replay.baselinePassK).toBeCloseTo(1 / 3);
    expect(replay.candidatePassK).toBeCloseTo(1);
    expect(replay.candidatePassK).toBeGreaterThan(replay.baselinePassK);
    expect(replay.costPerResolvedTask).toBe(30);
    expect(replay.tasks).toHaveLength(3);
    expect(replay.tasks.every((entry) => entry.acceptanceCmd.length > 0)).toBe(true);
    expect(replay.tasks).toEqual([
      {
        id: "one",
        acceptanceCmd: "test one",
        baselinePassed: true,
        candidatePassed: true,
        ms: 30,
      },
      {
        id: "two",
        acceptanceCmd: "test two",
        baselinePassed: false,
        candidatePassed: true,
        ms: 30,
      },
      {
        id: "three",
        acceptanceCmd: "test three",
        baselinePassed: false,
        candidatePassed: true,
        ms: 30,
      },
    ]);

    expect(report.delta).toBeCloseTo(2 / 3);
    expect(report.improved).toBe(true);
    expect(report.taskCount).toBe(3);
    expect(report.passedCount).toBe(3);
    expect(report.markdown).toContain("delta");
    expect(report.markdown).toContain("任务数: 3");
    expect(report.markdown).toContain("候选通过数: 3");
    expect(report.markdown).toContain(`生成时间: ${measuredAt}`);
  });

  test("calls injected attempts once per task for both baseline and candidate rules", async () => {
    const tasks = [task("one"), task("two"), task("three")];
    const runAttempt = vi.fn(async (_task: RegressionTask, rules: string): Promise<AgentAttempt> => ({
      passed: rules === candidateRules,
      ms: 7,
    }));

    await runAgentDifferential({
      ...baseConfig(tasks),
      runAttempt,
    });

    expect(runAttempt).toHaveBeenCalledTimes(2 * tasks.length);
    for (const [index, regressionTask] of tasks.entries()) {
      expect(runAttempt).toHaveBeenNthCalledWith((index * 2) + 1, regressionTask, baselineRules, baselineCwd);
      expect(runAttempt).toHaveBeenNthCalledWith((index * 2) + 2, regressionTask, candidateRules, candidateCwd);
    }
  });

  test("records a negative differential when candidate rules perform worse", async () => {
    const tasks = [task("one"), task("two"), task("three")];
    const runAttempt = vi.fn(async (regressionTask: RegressionTask, rules: string): Promise<AgentAttempt> => {
      if (rules === baselineRules) return { passed: true, ms: 5 };
      return { passed: regressionTask.id === "one", ms: 11 };
    });

    const { replay, report } = await runAgentDifferential({
      ...baseConfig(tasks),
      runAttempt,
    });

    expect(replay.baselinePassK).toBeCloseTo(1);
    expect(replay.candidatePassK).toBeCloseTo(1 / 3);
    expect(replay.candidatePassK).toBeLessThan(replay.baselinePassK);
    expect(report.delta).toBeLessThan(0);
    expect(report.improved).toBe(false);
  });

  test("returns a zero report for an empty holdout without throwing", async () => {
    const runAttempt = vi.fn(async (): Promise<AgentAttempt> => ({ passed: true, ms: 1 }));

    await expect(runAgentDifferential({
      ...baseConfig([]),
      runAttempt,
    })).resolves.toMatchObject({
      replay: {
        baselinePassK: 0,
        candidatePassK: 0,
        costPerResolvedTask: 0,
        tasks: [],
        measuredAt,
      },
      report: {
        delta: 0,
        improved: false,
        taskCount: 0,
        passedCount: 0,
      },
    });
    expect(runAttempt).not.toHaveBeenCalled();
  });
});
