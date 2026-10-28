import { describe, expect, it, vi } from "vitest";
import { replayHoldout } from "../../src/evolution/eval-replay.js";
import { renderEvalReport, type ReplayResult as ReportReplay } from "../../src/evolution/eval-report.js";
import type { DifferentialEvalDeps } from "../../src/evolution/eval-runner.js";
import type { RegressionTask } from "../../src/evolution/regression-store.js";

type Outcome = { baseline: boolean; candidate: boolean };

function task(id: string): RegressionTask {
  return {
    id,
    requirement: `requirement ${id}`,
    acceptanceCmd: `cmd-${id}`,
    sourceFlow: id,
    set: "holdout",
    createdAt: 1,
  };
}

/** 按 acceptanceCmd 里的下标决定该条任务基线/候选是否通过。 */
function deps(outcomes: Outcome[]): DifferentialEvalDeps {
  const tasks = outcomes.map((_, i) => task(String(i)));
  const pick = (cmd: string) => outcomes[Number(cmd.replace("cmd-", ""))];
  return {
    listHoldout: async () => tasks,
    runBaseline: async (cmd: string) => ({ passed: pick(cmd)?.baseline ?? false, ms: 1 }),
    runCandidate: async (cmd: string) => ({ passed: pick(cmd)?.candidate ?? false, ms: 1 }),
    cwd: "/fake/cwd",
  };
}

const IMPROVE: Outcome = { baseline: false, candidate: true };
const REGRESS: Outcome = { baseline: true, candidate: false };
const BOTH_FAIL: Outcome = { baseline: false, candidate: false };
const BOTH_PASS: Outcome = { baseline: true, candidate: true };

describe("配对统计量", () => {
  it("全部由不过变成过：delta=1、SE=0、与噪声可区分", async () => {
    const r = await replayHoldout(deps([IMPROVE, IMPROVE, IMPROVE, IMPROVE]));
    expect(r.pairedDelta).toBe(1);
    expect(r.pairedStdError).toBe(0);
    expect(r.discernible).toBe(true);
  });

  it("全部毫无变化：delta=0、判落在噪声内", async () => {
    const r = await replayHoldout(deps([BOTH_PASS, BOTH_PASS, BOTH_FAIL, BOTH_FAIL]));
    expect(r.pairedDelta).toBe(0);
    expect(r.discernible).toBe(false);
  });

  it("一半改善一半恶化：净零但离散度大于零，落在噪声内", async () => {
    const r = await replayHoldout(deps([IMPROVE, REGRESS, IMPROVE, REGRESS]));
    expect(r.pairedDelta).toBe(0);
    expect(r.pairedStdError).toBeGreaterThan(0);
    expect(r.discernible).toBe(false);
  });

  it("小幅净改善但噪声大 → 落在噪声内", async () => {
    const r = await replayHoldout(deps([...Array(6).fill(IMPROVE), ...Array(4).fill(REGRESS)]));
    expect(r.pairedDelta).toBeCloseTo(0.2, 6);
    expect(r.discernible).toBe(false);
  });

  it("大幅一致改善 → 与噪声可区分", async () => {
    const r = await replayHoldout(deps([...Array(9).fill(IMPROVE), BOTH_FAIL]));
    expect(r.pairedDelta).toBeCloseTo(0.9, 6);
    expect(r.discernible).toBe(true);
  });

  it("空 holdout：0/0/false 且不产生 NaN", async () => {
    const r = await replayHoldout(deps([]));
    expect(r.pairedDelta).toBe(0);
    expect(r.pairedStdError).toBe(0);
    expect(r.discernible).toBe(false);
    expect(Number.isNaN(r.pairedDelta)).toBe(false);
    expect(Number.isNaN(r.pairedStdError)).toBe(false);
  });

  it("单条任务：SE=0 且判落在噪声内（单样本无从判离散度）", async () => {
    const r = await replayHoldout(deps([IMPROVE]));
    expect(r.pairedStdError).toBe(0);
    expect(r.discernible).toBe(false);
  });

  it("iterations>1 时按分数计而非布尔：3 次过 2 次记 2/3", async () => {
    const t = [task("solo")];
    let baselineCalls = 0;
    let candidateCalls = 0;
    const r = await replayHoldout(
      {
        listHoldout: async () => t,
        // 基线 3 次全不过
        runBaseline: async () => {
          baselineCalls += 1;
          return { passed: false, ms: 1 };
        },
        // 候选 3 次里过 2 次
        runCandidate: async () => {
          candidateCalls += 1;
          return { passed: candidateCalls <= 2, ms: 1 };
        },
        cwd: "/fake/cwd",
      },
      { iterations: 3 },
    );
    expect(baselineCalls).toBeGreaterThan(0);
    // d = 2/3 - 0/3
    expect(r.pairedDelta).toBeCloseTo(2 / 3, 6);
  });

  it("配对统计量是对既有结果的后处理：baseline 与 candidate 的调用次数相等", async () => {
    const runBaseline = vi.fn(async () => ({ passed: false, ms: 1 }));
    const runCandidate = vi.fn(async () => ({ passed: true, ms: 1 }));
    await replayHoldout({
      listHoldout: async () => [task("a"), task("b"), task("c")],
      runBaseline,
      runCandidate,
      cwd: "/fake/cwd",
    });
    expect(runBaseline.mock.calls.length).toBe(runCandidate.mock.calls.length);
  });
});

describe("评测报告显示配对统计量", () => {
  const baseReplay = {
    baselinePassK: 0.5,
    candidatePassK: 0.7,
    costPerResolvedTask: 3,
    tasks: [
      { id: "t0", acceptanceCmd: "c0", baselinePassed: false, candidatePassed: true, ms: 1 },
      { id: "t1", acceptanceCmd: "c1", baselinePassed: true, candidatePassed: true, ms: 1 },
    ],
  } as ReportReplay;

  it("判可区分时，概要里出现配对 delta、标准误与判定", () => {
    const out = renderEvalReport({
      ...baseReplay,
      pairedDelta: 0.2,
      pairedStdError: 0.03,
      discernible: true,
    });
    expect(out.markdown).toContain("0.2");
    expect(out.markdown).toContain("0.03");
    expect(out.markdown).toContain("与噪声可区分");
  });

  it("判落在噪声内时报告如实写出，且不得出现可区分字样", () => {
    const out = renderEvalReport({
      ...baseReplay,
      pairedDelta: 0.02,
      pairedStdError: 0.09,
      discernible: false,
    });
    expect(out.markdown).toContain("落在噪声内");
    expect(out.markdown).not.toContain("与噪声可区分");
  });

  it("不带配对字段时，概要里不出现任何判定字样（既有行为不变）", () => {
    const out = renderEvalReport(baseReplay);
    expect(out.markdown).not.toContain("与噪声可区分");
    expect(out.markdown).not.toContain("落在噪声内");
    expect(out.markdown).toContain("## 概要");
  });
});