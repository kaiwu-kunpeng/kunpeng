import { describe, expect, it } from "vitest";
import { buildPilotPrompt, parseWavePlan } from "../src/loop/ops-pilot.js";

const loop = {
  id: "l1", name: "GEO", projectId: "acme", recipe: "geo",
  metric: { key: "citations", label: "AI引用数", current: 2 },
  goal: { target: 8, direction: "up" as const },
  levers: [{ lever: "expand", note: "扩 prompt 集" }, { lever: "content", note: "补内容" }],
  waves: [], createdAt: 1, updatedAt: 1,
} as never;

describe("OpsPilot 决策头(作者验收)", () => {
  it("prompt 含目标/台账/候选技能/输出约束", () => {
    const p = buildPilotPrompt(loop, [
      { at: 1, loopId: "l1", projectId: "acme", recipe: "geo", lever: "expand", subject: "w1", metricKey: "citations", metricAfter: 2, metricDelta: 1, verified: true },
    ] as never, [{ id: "geo-watch", name: "geo-watch", description: "GEO 监控方法论" }]);
    expect(p).toContain("citations");
    expect(p).toContain("8");
    expect(p).toContain("geo-watch");
    expect(p).toContain("expand");
    expect(p).toContain("JSON");
    expect(p).toContain("stopLoss");
  });

  it("parseWavePlan:取第一个 JSON、过滤未知技能、拒绝未知 lever", () => {
    const ok = parseWavePlan(
      '前置噪声 {"lever":"expand","skills":["geo-watch","ghost"],"waveGoal":"到4","stopLoss":"两波无增","reason":"r"} tokens used 123',
      { levers: ["expand", "content"], skills: ["geo-watch"] },
    );
    expect("error" in ok).toBe(false);
    if (!("error" in ok)) {
      expect(ok.lever).toBe("expand");
      expect(ok.skills).toEqual(["geo-watch"]);
      expect(ok.stopLoss).toContain("两波");
    }
    const bad = parseWavePlan('{"lever":"nope","skills":[]}', { levers: ["expand"], skills: [] });
    expect("error" in bad).toBe(true);
  });

  it("嵌套/转义 JSON 也能平衡扫描", () => {
    const r = parseWavePlan(
      '{"lever":"expand","skills":[],"waveGoal":"含\\"引号\\"和{花括号}","stopLoss":"s","reason":"r"} {"lever":"content"}',
      { levers: ["expand", "content"], skills: [] },
    );
    expect("error" in r).toBe(false);
    if (!("error" in r)) expect(r.waveGoal).toContain("花括号");
  });
});