import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("goal 接线（作者锁定）", () => {
  it("cli.ts 解析 --goal、注册 goal 命令；registry 有 goalArg", () => {
    const cli = read("../../src/cli.ts");
    expect(cli).toContain('argv[i] === "--goal"');
    expect(cli).toContain("goalArg");
    expect(cli).toContain('import "./cli-commands/goals.js"');
    expect(cli).toMatch(/命令: [^\n]*\| goal \|/);
    expect(read("../../src/cli-commands/registry.ts")).toContain("goalArg?: string");
  });

  it("run/plan 从 --goal 或需求文本取 goalId 并透传；plan 编排器下发到子流与集成流", () => {
    const devcycle = read("../../src/cli-commands/devcycle.ts");
    expect(devcycle).toContain("context.goalArg ?? parseGoalId(requirement)");
    expect(devcycle).toContain("未登记的目标");
    const loopCore = read("../../src/cli-commands/loop-core.ts");
    expect(loopCore).toContain("context.goalArg ?? parseGoalId(md)");
    const orchestrator = read("../../src/plan/orchestrator.ts");
    expect(orchestrator).toContain("goalId?: string");
    expect((orchestrator.match(/goalId: d\.goalId/g) ?? []).length).toBeGreaterThanOrEqual(2);
    const devCycle = read("../../src/loop/dev-cycle.ts");
    expect(devCycle).toContain("goalId?: string");
    expect(devCycle).toContain("goalId: this.d.goalId");
  });

  it("goal 命令有 add/list/done/pause/set-current 五个子命令", () => {
    const goals = read("../../src/cli-commands/goals.ts");
    expect(goals).toContain('name: "goal"');
    for (const sub of ['"add"', '"list"', '"done"', '"pause"', '"set-current"']) expect(goals).toContain(sub);
    expect(goals).toContain("--metric");
    expect(goals).toContain("未归属流");
    expect(goals).toContain("flowsUsdStageMix");
  });
});