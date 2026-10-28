import { describe, expect, it } from "vitest";
import { skillBattleStats, buildWaveReport } from "../src/loop/wave-report.js";
import { buildPilotPrompt } from "../src/loop/ops-pilot.js";

function act(loopId: string, at: number, delta: number, verified: boolean) {
  return { at, loopId, projectId: "p", recipe: "geo", lever: "x", subject: "s", metricKey: "k", metricAfter: 5, metricDelta: delta, verified };
}

describe("WaveReport 与战绩回灌(作者验收)", () => {
  it("skillBattleStats:win 只算 verified 且 delta>0 的后续动作", () => {
    const plans = [
      { at: 10, loopId: "l1", plan: { skills: ["a", "b"] } },
      { at: 30, loopId: "l1", plan: { skills: ["a"] } },
      { at: 10, loopId: "l2", plan: { skills: ["c"] } },
    ];
    const actions = [act("l1", 15, 2, true), act("l1", 35, -1, true)] as never;
    const stats = skillBattleStats(plans, actions);
    expect(stats.a).toEqual({ picked: 2, wins: 1 });
    expect(stats.b).toEqual({ picked: 1, wins: 1 });
    expect(stats.c).toEqual({ picked: 1, wins: 0 });
  });

  it("buildWaveReport 含指标变化/技能/goal 进度", () => {
    const md = buildWaveReport({
      loop: { id: "l1", name: "GEO 监控", metric: { label: "AI引用", current: 5 }, goal: { target: 10 } },
      action: act("l1", 99, 2, true) as never,
      planSkills: ["geo-watch"],
    });
    expect(md).toContain("GEO 监控");
    expect(md).toContain("geo-watch");
    expect(md).toContain("2");
    expect(md).toContain("10");
  });

  it("buildPilotPrompt 带战绩行", () => {
    const loop = {
      id: "l1", name: "GEO", projectId: "p", recipe: "geo",
      metric: { key: "cit", label: "引用", current: 2 },
      levers: [{ lever: "expand" }], waves: [], createdAt: 1, updatedAt: 1,
    } as never;
    const p = buildPilotPrompt(loop, [] as never, [{ id: "geo-watch", name: "geo-watch", description: "d" }], { "geo-watch": { picked: 3, wins: 2 } });
    expect(p).toContain("3");
    expect(p).toContain("2");
    expect(p.includes("战绩") || p.toLowerCase().includes("picked")).toBe(true);
  });
});