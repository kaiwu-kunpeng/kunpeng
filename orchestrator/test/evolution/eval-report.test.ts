import { describe, expect, test } from "vitest";
import { renderEvalReport, type ReplayResult } from "../../src/evolution/eval-report";

describe("renderEvalReport", () => {
  test("renders an improved report with meta, summary, task details, and repeat command", () => {
    const replay: ReplayResult = {
      baselinePassK: 1 / 3,
      candidatePassK: 1,
      costPerResolvedTask: 120,
      tasks: [
        {
          id: "task-1",
          acceptanceCmd: "npm run accept -- task-1",
          baselinePassed: true,
          candidatePassed: true,
          ms: 10,
        },
        {
          id: "task-2",
          acceptanceCmd: "npm run accept -- task-2",
          baselinePassed: false,
          candidatePassed: true,
          ms: 20,
        },
        {
          id: "task-3",
          acceptanceCmd: "npm run accept -- task-3",
          baselinePassed: false,
          candidatePassed: true,
          ms: 30,
        },
      ],
    };

    const report = renderEvalReport(replay, {
      proposalId: "p1",
      proposalTitle: "强化 X",
      repeatCmd: "cd orchestrator && npm run eval:replay -- p1",
      generatedAt: 999,
    });

    expect(report.delta).toBeCloseTo(2 / 3);
    expect(report.improved).toBe(true);
    expect(report.taskCount).toBe(3);
    expect(report.passedCount).toBe(3);

    expect(report.markdown).toContain("自我进化·可复现报告");
    expect(report.markdown).toContain("强化 X");
    expect(report.markdown).toContain("p1");
    expect(report.markdown).toContain("提案前通过率");
    expect(report.markdown).toContain("33.3%");
    expect(report.markdown).toContain("提案后通过率");
    expect(report.markdown).toContain("100.0%");
    expect(report.markdown).toContain("delta");
    expect(report.markdown).toContain("+66.7%");
    expect(report.markdown).toContain("是否改进");
    expect(report.markdown).toContain("costPerResolvedTask");
    expect(report.markdown).toContain("任务数");
    expect(report.markdown).toContain("候选通过数");
    expect(report.markdown).toContain("npm run accept -- task-1");
    expect(report.markdown).toContain("npm run accept -- task-2");
    expect(report.markdown).toContain("npm run accept -- task-3");
    expect(report.markdown).toContain("可重跑命令");
    expect(report.markdown).toContain("npm run eval:replay");
  });

  test("renders negative and flat delta signs", () => {
    const degraded = renderEvalReport({
      baselinePassK: 1,
      candidatePassK: 1 / 3,
      costPerResolvedTask: 1,
      tasks: [],
    });

    expect(degraded.delta).toBeLessThan(0);
    expect(degraded.improved).toBe(false);
    expect(degraded.markdown).toContain("-66.7%");
    expect(degraded.markdown).toContain("是否改进: 否");

    const flat = renderEvalReport({
      baselinePassK: 0.5,
      candidatePassK: 0.5,
      costPerResolvedTask: 1,
      tasks: [],
    });

    expect(flat.delta).toBe(0);
    expect(flat.improved).toBe(false);
    expect(flat.markdown).toContain("+0.0%");
  });

  test("renders empty task details without meta", () => {
    expect(() => renderEvalReport({
      baselinePassK: 0,
      candidatePassK: 0,
      costPerResolvedTask: 0,
      tasks: [],
    })).not.toThrow();

    const report = renderEvalReport({
      baselinePassK: 0,
      candidatePassK: 0,
      costPerResolvedTask: 0,
      tasks: [],
    });

    expect(report.taskCount).toBe(0);
    expect(report.passedCount).toBe(0);
    expect(report.markdown).toContain("（无任务明细：holdout 为空）");
    expect(report.markdown).toContain("未提供重跑命令");
  });

  test("is deterministic and does not mutate inputs", () => {
    const replay: ReplayResult = {
      baselinePassK: 0,
      candidatePassK: 1,
      costPerResolvedTask: 5,
      tasks: [
        {
          id: "stable",
          acceptanceCmd: "npm run accept -- stable",
          baselinePassed: false,
          candidatePassed: true,
          ms: 5,
        },
      ],
    };
    const meta = {
      proposalId: "stable-proposal",
      proposalTitle: "稳定报告",
      repeatCmd: "npm run eval:replay -- stable-proposal",
      generatedAt: 100,
    };

    const beforeLength = replay.tasks.length;
    const first = renderEvalReport(replay, meta);
    const second = renderEvalReport(replay, meta);

    expect(second.markdown).toBe(first.markdown);
    expect(second).toEqual(first);
    expect(replay.tasks.length).toBe(beforeLength);
  });
});
