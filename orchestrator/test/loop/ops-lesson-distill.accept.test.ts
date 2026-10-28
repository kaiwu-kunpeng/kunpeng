import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listLessons } from "../../src/knowledge/lesson-store.js";
import { OPS_LESSON_MIN_WAVES, OPS_LESSON_WIN_RATIO, distillOpsLessons } from "../../src/knowledge/ops-lesson-distill.js";
import { appendAction, type OpsAction } from "../../src/loop/action-ledger.js";
import { runPlaybook } from "../../src/loop/ops-playbook-run.js";
import { LoopStore } from "../../src/loop/store.js";
import type { LoopDef } from "../../src/loop/types.js";

// 背景（2026-10-03 运营审计 A3 G4，总报告 P1-8 第三步）：经验库只从开发环失败蒸馏（LLM），运营环的 actions.jsonl + waveplans
// 从来没变成经验——领航每波都在零经验上拍脑袋。本测试锁定：确定性蒸馏（C8，不调 LLM）杠杆 / 技能战绩 → tier-1 经验；
// 阈值 3 波、胜率 ≥2/3 成功、0 胜失败、中间不出；signature 去重幂等；`ops run-playbook` 跑完一波自动蒸馏并落 lessons。

const act = (over: Partial<OpsAction>): OpsAction => ({ at: 1, loopId: "demo-l", projectId: "demo", recipe: "agent-playbook", lever: "write", subject: "t", metricKey: "m", metricAfter: 1, metricDelta: 1, verified: true, ...over });

describe("distillOpsLessons 纯判定（作者锁定）", () => {
  it("阈值与比例常量；不足 3 波不出；3 胜→success；0 胜→failure；1/3 中间地带不出；经验字段齐全且 tier 1", () => {
    expect(OPS_LESSON_MIN_WAVES).toBe(3);
    expect(OPS_LESSON_WIN_RATIO).toBeCloseTo(2 / 3);
    expect(distillOpsLessons({ loopId: "demo-l", actions: [act({ at: 1 }), act({ at: 2 })], waveplans: [], now: 9 })).toEqual([]);
    const good = distillOpsLessons({ loopId: "demo-l", actions: [act({ at: 1 }), act({ at: 2 }), act({ at: 3, metricDelta: 2 }), act({ at: 4, loopId: "other-l" })], waveplans: [], now: 9 });
    expect(good).toHaveLength(1);
    expect(good[0]).toMatchObject({ id: "ops-lever-demo-l-write-success", polarity: "success", trustTier: 1, projectId: "demo", signature: "ops-lever:demo-l:write:success", sourceIds: ["demo-l@1", "demo-l@2", "demo-l@3"], evidence: "3 胜 / 0 负，最近一波 Δ=2", createdAt: 9, stats: { injected: 0, wins: 0, losses: 0 } });
    expect(good[0]!.title).toContain("杠杆「write」");
    const bad = distillOpsLessons({ loopId: "demo-l", actions: [act({ at: 1, metricDelta: 0 }), act({ at: 2, metricDelta: -1 }), act({ at: 3, verified: false, metricDelta: 5 })], waveplans: [], now: 9 });
    expect(bad.map((l) => [l.polarity, l.signature])).toEqual([["failure", "ops-lever:demo-l:write:failure"]]);
    expect(bad[0]!.content).toContain("换杠杆");
    const mixed = distillOpsLessons({ loopId: "demo-l", actions: [act({ at: 1 }), act({ at: 2, metricDelta: 0 }), act({ at: 3, metricDelta: 0 })], waveplans: [], now: 9 });
    expect(mixed).toEqual([]);
  });

  it("技能维度：领航选过 ≥3 波的技能按首个后续波判胜负；两维度同时出、先杠杆后技能、各按名字排序", () => {
    const actions = [
      act({ at: 10, lever: "a" }), act({ at: 20, lever: "a" }), act({ at: 30, lever: "a", metricDelta: 3 }),
      act({ at: 40, lever: "b", metricDelta: 0 }), act({ at: 50, lever: "b", metricDelta: -1 }), act({ at: 60, lever: "b", verified: false, metricDelta: 9 }),
    ];
    const plan = (at: number, skills: string[]) => ({ at, loopId: "demo-l", plan: { lever: "a", skills, waveGoal: "g", stopLoss: "s", reason: "r" } });
    const lessons = distillOpsLessons({ loopId: "demo-l", actions, waveplans: [plan(5, ["sk-win"]), plan(15, ["sk-win"]), plan(25, ["sk-win"]), plan(35, ["sk-lose"]), plan(45, ["sk-lose"]), plan(55, ["sk-lose"]), plan(1, ["sk-rare"])], now: 9 });
    expect(lessons.map((l) => l.signature)).toEqual(["ops-lever:demo-l:a:success", "ops-lever:demo-l:b:failure", "ops-skill:demo-l:sk-lose:failure", "ops-skill:demo-l:sk-win:success"]);
    const win = lessons.find((l) => l.signature === "ops-skill:demo-l:sk-win:success")!;
    expect(win.evidence).toBe("3 胜 / 0 负");
    expect(win.sourceIds).toEqual(["demo-l@plan:5", "demo-l@plan:15", "demo-l@plan:25"]);
    expect(lessons.find((l) => l.signature === "ops-lever:demo-l:b:failure")!.evidence).toBe("0 胜 / 3 负，最近一波 Δ=9");
  });
});

describe("跑完一波自动蒸馏（作者锁定）", () => {
  let repo: string; let stateDir: string; let savedState: string | undefined;
  const loopDef = (): LoopDef => ({ id: "demo-l", name: "Demo", projectId: "demo", recipe: "agent-playbook", autonomous: true, metric: { key: "m", label: "M", current: 1 }, levers: [{ id: "write", label: "写", status: "active", level: "L2" }], nextLever: { lever: "write", target: "t" }, waves: [], createdAt: 1, updatedAt: 1 });
  beforeEach(async () => {
    savedState = process.env.KUNPENG_STATE; process.env.KUNPENG_STATE = mkdtempSync(join(tmpdir(), "kp-opsles-state-"));
    repo = mkdtempSync(join(tmpdir(), "kp-opsles-repo-")); execFileSync("git", ["init", "--quiet", repo]);
    stateDir = join(repo, ".kunpeng", "state");
    await new LoopStore(join(repo, ".kunpeng", "loops")).create(loopDef());
    mkdirSync(join(repo, ".kunpeng", "playbooks"), { recursive: true });
    writeFileSync(join(repo, ".kunpeng", "playbooks", "pb.md"), "---\nid: pb\nloopId: demo-l\ncadence: daily\ngate: auto\n---\n# pb\n", "utf8");
    for (const at of [1_000, 2_000]) await appendAction(stateDir, act({ at, metricDelta: 1 }));
  });
  afterEach(() => { rmSync(process.env.KUNPENG_STATE!, { recursive: true, force: true }); if (savedState === undefined) delete process.env.KUNPENG_STATE; else process.env.KUNPENG_STATE = savedState; rmSync(repo, { recursive: true, force: true }); });
  const fakeRunWave = (at: number, delta: number) => vi.fn(async (loopId: string) => {
    await appendAction(stateDir, act({ at, loopId, metricDelta: delta, metricAfter: 1 + delta }));
    return { gated: false as const, loop: loopDef(), flowId: `loop-${loopId}-w`, wave: { seq: 3, at, lever: "write", subject: "t", metricDelta: delta, metricAfter: 1 + delta, verified: true }, result: { metricBefore: 1, metricAfter: 1 + delta, metricDelta: delta, verified: true } };
  });

  it("第 3 波跑完 → lessons.jsonl 出现 tier-1 杠杆成功经验并 log；再跑一波同 signature 只合并 sourceIds 不重复；无 waveplan 也蒸馏", async () => {
    const lines: string[] = [];
    const entry = await runPlaybook(repo, stateDir, "pb", { runWave: fakeRunWave(3_000, 2), log: (l) => { lines.push(l); }, now: () => 9_000 });
    expect(entry.outcome).toBe("ran");
    let lessons = await listLessons(stateDir);
    expect(lessons).toHaveLength(1);
    expect(lessons[0]).toMatchObject({ signature: "ops-lever:demo-l:write:success", trustTier: 1, polarity: "success", sourceIds: ["demo-l@1000", "demo-l@2000", "demo-l@3000"] });
    expect(lines.some((l) => l.includes("运营经验已蒸馏：1 条"))).toBe(true);
    await runPlaybook(repo, stateDir, "pb", { runWave: fakeRunWave(4_000, 1), log: () => undefined, now: () => 10_000 });
    lessons = await listLessons(stateDir);
    expect(lessons).toHaveLength(1);
    expect(lessons[0]!.sourceIds).toEqual(["demo-l@1000", "demo-l@2000", "demo-l@3000", "demo-l@4000"]);
  });
});