import { describe, it, expect, vi } from "vitest";
import { parseMetricOutput, runAgentPlaybookWave } from "./runwave.js";
import type { LoopDef } from "../../types.js";

const loop: LoopDef = {
  id: "L", name: "n", projectId: "p", recipe: "agent-playbook",
  metric: { key: "briefs", label: "简报数", current: 2 },
  levers: [{ id: "lv", label: "lv", status: "active" }],
  nextLever: { lever: "lv" },
  waves: [], createdAt: 1, updatedAt: 1,
};

const PLAYBOOK_BODY = [
  "# demo",
  "```aop",
  JSON.stringify({ goal: "g", steps: [{ id: "s1", prompt: "do one thing" }] }),
  "```",
].join("\n");

describe("parseMetricOutput", () => {
  it("取最后一个可解析数字", () => {
    expect(parseMetricOutput("scanning...\nfound\n7\n")).toBe(7);
  });
  it("容忍空白与小数", () => {
    expect(parseMetricOutput("  12.5  ")).toBe(12.5);
  });
  it("没有数字时返回 undefined", () => {
    expect(parseMetricOutput("nothing here")).toBeUndefined();
  });
  it("空输出返回 undefined 且不抛", () => {
    expect(parseMetricOutput("")).toBeUndefined();
  });
});

describe("runAgentPlaybookWave 计量", () => {
  it("metricCmd 输出数字时按真实增量记", async () => {
    const res = await runAgentPlaybookWave(loop, "lv", "lv", {
      repoPath: "/tmp/kp-metric-test",
      runner: { runStep: vi.fn(async () => {}) },
      loadPlaybook: async () => ({ body: PLAYBOOK_BODY, metricCmd: "echo 5" }),
      execAssert: async () => 0,
      execMetric: async () => "5\n",
    });
    expect(res.verified).toBe(true);
    expect(res.metricAfter).toBe(5);
    expect(res.metricDelta).toBe(3);
  });

  it("没有 metricCmd 时维持旧行为(零增量)", async () => {
    const res = await runAgentPlaybookWave(loop, "lv", "lv", {
      repoPath: "/tmp/kp-metric-test",
      runner: { runStep: vi.fn(async () => {}) },
      loadPlaybook: async () => ({ body: PLAYBOOK_BODY }),
      execAssert: async () => 0,
    });
    expect(res.verified).toBe(true);
    expect(res.metricDelta).toBe(0);
    expect(res.metricAfter).toBe(2);
  });

  it("metricCmd 解析不出数字时退回零增量并留 gotcha", async () => {
    const res = await runAgentPlaybookWave(loop, "lv", "lv", {
      repoPath: "/tmp/kp-metric-test",
      runner: { runStep: vi.fn(async () => {}) },
      loadPlaybook: async () => ({ body: PLAYBOOK_BODY, metricCmd: "echo oops" }),
      execAssert: async () => 0,
      execMetric: async () => "oops",
    });
    expect(res.metricDelta).toBe(0);
    expect(res.metricAfter).toBe(2);
    expect((res.gotchas ?? []).some((g) => g.includes("metricCmd"))).toBe(true);
  });

  it("metricCmd 执行抛错不影响波次成功", async () => {
    const res = await runAgentPlaybookWave(loop, "lv", "lv", {
      repoPath: "/tmp/kp-metric-test",
      runner: { runStep: vi.fn(async () => {}) },
      loadPlaybook: async () => ({ body: PLAYBOOK_BODY, metricCmd: "false" }),
      execAssert: async () => 0,
      execMetric: async () => { throw new Error("boom"); },
    });
    expect(res.verified).toBe(true);
    expect(res.metricDelta).toBe(0);
  });
});