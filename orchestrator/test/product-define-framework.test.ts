import { expect, test } from "vitest";
import type { AgentRunner } from "../src/agent/runner.js";
import { autoDefineProduct, buildAutoDefinePrompt } from "../src/product/auto-define.js";
import { definitionToSpec } from "../src/product/to-spec.js";

function fakeRunner(output: unknown): AgentRunner {
  return { run: async () => output } as AgentRunner;
}

test("auto-define prompt 含具体性要求 + JTBD + nonGoals", () => {
  const prompt = buildAutoDefinePrompt("做个待办App");

  expect(prompt).toContain("具体客户");
  expect(prompt).toContain("jobStatement");
  expect(prompt).toContain("nonGoals");
  expect(prompt).toContain("单行 JSON");
});

test("parseDefinition 解析 jobStatement/nonGoals", async () => {
  const json = JSON.stringify({
    problem: "自由职业设计师在多个客户项目并行时遗漏待办截止时间",
    jobStatement: "当多个客户项目并行时自由职业设计师想集中看到下一步动作以便按时交付",
    users: ["自由职业设计师"],
    stories: ["作为自由职业设计师，我要按客户查看待办"],
    acceptance: ["能按客户展示未完成任务"],
    nonGoals: ["不做团队绩效管理"],
  });

  const definition = await autoDefineProduct("做个待办App", fakeRunner(json));

  expect(definition.jobStatement).toBe("当多个客户项目并行时自由职业设计师想集中看到下一步动作以便按时交付");
  expect(definition.nonGoals).toEqual(["不做团队绩效管理"]);
});

test("to-spec 渲染 JTBD + 真 nonGoals", () => {
  const out = definitionToSpec({
    idea: "x",
    problem: "p",
    users: ["u"],
    stories: ["s"],
    acceptance: ["a"],
    jobStatement: "当A时B想C",
    nonGoals: ["不做X"],
  });

  expect(out).toContain("当A时B想C");
  expect(out).toContain("不做X");
  expect(out).not.toContain("（待补充）");
});

test("向后兼容:无 jobStatement/nonGoals 的旧定义仍渲染", () => {
  const out = definitionToSpec({
    idea: "x",
    problem: "p",
    users: ["u"],
    stories: ["s"],
    acceptance: ["a"],
  });

  expect(out).toContain("**用户的 Job（JTBD）**：（未明确）");
  expect(out).toContain("- （未明确）");
});
