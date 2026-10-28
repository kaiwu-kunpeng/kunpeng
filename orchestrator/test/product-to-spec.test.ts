import { expect, test } from "vitest";
import type { ProductDefinition } from "../src/product/contract.js";
import { definitionToSpec } from "../src/product/to-spec.js";

test("definitionToSpec renders a complete definition as a PR FAQ single-flow draft", () => {
  const def: ProductDefinition = {
    idea: "待办协作",
    problem: "项目经理每天手动核对20个任务状态耗时1小时",
    jobStatement: "当项目经理每天同步项目状态时，需要快速看到任务阻塞，以便减少遗漏。",
    users: ["项目经理", "开发者"],
    stories: ["作为项目经理，我要看到任务状态"],
    acceptance: ["能创建任务", "能标记完成"],
    nonGoals: ["不做聊天系统"],
  };

  const out = definitionToSpec(def);

  expect(out).toContain("# 段一：");
  expect(out).toContain(def.idea);
  expect(out).toContain("PR FAQ 需求草稿");
  expect(out).toContain("**Press Release**：");
  expect(out).toContain("**FAQ**：");
  expect(out).toContain("**[prfaq-problem] 问题**");
  expect(out).toContain(def.problem);
  expect(out).toContain("**[prfaq-users] 目标用户**");
  expect(out).toContain("- 项目经理");
  expect(out).toContain("- 开发者");
  expect(out).toContain("**[prfaq-scenarios] 核心场景**");
  expect(out).toContain("- 作为项目经理，我要看到任务状态");
  expect(out).toContain("**[prfaq-success] 成功标准**");
  expect(out).toContain("```gherkin");
  expect(out).toContain("Scenario: 能创建任务");
  expect(out).toContain("Then 能标记完成");
  expect(out).toContain("**[prfaq-non-goals] 非目标**");
  expect(out).toContain("- 不做聊天系统");
  expect(out).toContain("```accept");
  expect(out).toContain(
    "# 验收契约：上方每个 Gherkin 场景 = 1 个任务 = 1 个测试（每场景独立可测），实现时按场景拆分并逐一断言 Given/When/Then",
  );
  expect(out).toContain("```");
});

test("definitionToSpec uses one H1 and no H2 headings", () => {
  const out = definitionToSpec({
    idea: "待办协作",
    problem: "项目经理每天手动核对20个任务状态耗时1小时",
    jobStatement: "当项目经理每天同步项目状态时，需要快速看到任务阻塞，以便减少遗漏。",
    users: ["项目经理"],
    stories: ["作为项目经理，我要看到任务状态"],
    acceptance: ["能创建任务"],
    nonGoals: ["不做聊天系统"],
  });

  expect((out.match(/^# /gm) || []).length).toBe(1);
  expect(/^## /m.test(out)).toBe(false);
});

test("definitionToSpec keeps section labels when arrays are empty", () => {
  const out = definitionToSpec({
    idea: "待办协作",
    problem: "项目经理每天手动核对20个任务状态耗时1小时",
    users: [],
    stories: [],
    acceptance: [],
  });

  expect(out).toContain("**[prfaq-users] 目标用户**：");
  expect(out).toContain("**[prfaq-scenarios] 核心场景**：");
  expect(out).toContain("**[prfaq-success] 成功标准**：");
  expect(out).toContain("**[prfaq-non-goals] 非目标**：");
  const body = out.slice(out.indexOf("# 段一："));
  expect(body.match(/^- .+$/gm) || []).toEqual(["- （未明确）", "- （未明确）"]);
});

test("definitionToSpec uses a placeholder for empty idea", () => {
  const out = definitionToSpec({
    idea: "",
    problem: "项目经理每天手动核对20个任务状态耗时1小时",
    jobStatement: "当项目经理每天同步项目状态时，需要快速看到任务阻塞，以便减少遗漏。",
    users: ["项目经理"],
    stories: ["作为项目经理，我要看到任务状态"],
    acceptance: ["能创建任务"],
    nonGoals: ["不做聊天系统"],
  });

  expect(out).toContain("# 段一：（未命名需求）");
});

test("to-spec 对不达标定义渲染 🚫 拦截块", () => {
  const out = definitionToSpec({ idea: "x", problem: "提升效率", users: [], stories: [], acceptance: [] });

  expect(out).toContain("具体性门未通过");
  expect(out).toContain("> - [problem]");
  expect(out).toContain("> - [users]");
});

test("to-spec 对达标定义不渲染拦截块", () => {
  const out = definitionToSpec({
    idea: "跨境订单核对",
    problem: "跨境小卖家每天手动核对200条订单耗时2小时",
    users: ["跨境小卖家"],
    stories: ["作为跨境小卖家，我要在发货前快速发现订单金额差异"],
    acceptance: ["导入200条订单后能标出金额不一致的订单"],
    jobStatement: "当跨境小卖家每天发货前核对订单时，需要快速发现金额差异，以便减少错发漏发。",
    nonGoals: ["不做全渠道 ERP"],
  });

  expect(out).not.toContain("具体性门未通过");
});

test("to-spec 对 revise 定义渲染 🔴 红队块", () => {
  const out = definitionToSpec({
    idea: "跨境订单核对",
    problem: "跨境小卖家每天手动核对200条订单耗时2小时",
    users: ["跨境小卖家"],
    stories: ["作为跨境小卖家，我要在发货前快速发现订单金额差异"],
    acceptance: ["导入200条订单后能标出金额不一致的订单", "能导出异常订单CSV"],
    jobStatement: "当跨境小卖家每天发货前核对订单时，需要快速发现金额差异，以便减少错发漏发。",
    nonGoals: [],
  });

  expect(out).toContain("PM 红队评审");
});

test("to-spec 渲染 gherkin 验收块", () => {
  const out = definitionToSpec({
    idea: "跨境订单核对",
    problem: "跨境小卖家每天手动核对200条订单",
    users: ["小卖家"],
    stories: ["s"],
    acceptance: ["用户能一键导出对账CSV"],
  });

  expect(out).toContain("```gherkin");
  expect(out).toContain("Scenario:");
});
