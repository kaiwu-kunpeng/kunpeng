import { expect, test } from "vitest";
import {
  liftAcceptance,
  parseGherkin,
  renderGherkin,
  validateScenarios,
  type GherkinScenario,
} from "../src/product/gherkin.js";

test("parseGherkin 解析 Scenario/Given/When/Then/And", () => {
  const scenarios = parseGherkin(`
Feature: 导出

Scenario: 导出 CSV
  Given 已导入订单
  And 订单包含金额
  When 点击导出
  And 选择 CSV
  Then 下载文件
  And 文件包含订单

Scenario: 中文场景
  假设 已登录
  并且 有权限
  当 打开页面
  并且 点击按钮
  那么 看到结果
  并且 结果可下载
`);

  expect(scenarios).toHaveLength(2);
  expect(scenarios[0].when).toEqual(["点击导出", "选择 CSV"]);
});

test("validateScenarios 拒绝缺 Then 的场景", () => {
  const result = validateScenarios([{ title: "x", given: [], when: ["w"], then: [] }]);

  expect(result.ok).toBe(false);
  expect(result.errors.join("\n")).toContain("x");
});

test("validateScenarios 放行完整场景", () => {
  const result = validateScenarios([{ title: "完整", given: [], when: ["w"], then: ["t"] }]);

  expect(result.ok).toBe(true);
});

test("liftAcceptance 把自由验收提升为可校验场景", () => {
  const scenarios = liftAcceptance(["用户能导出CSV"]);

  expect(scenarios).toHaveLength(1);
  expect(validateScenarios(scenarios).ok).toBe(true);
});

test("liftAcceptance 解析已是 Given-When-Then 的字符串", () => {
  const scenarios = liftAcceptance(["当点击导出时\n那么下载CSV"]);

  expect(scenarios[0].when).toContain("点击导出");
  expect(scenarios[0].then).toContain("下载CSV");
});

test("renderGherkin 往返：parse(render(scn)) 等价", () => {
  const scenarios: GherkinScenario[] = [
    {
      title: "导出 CSV",
      given: ["已导入订单", "订单包含金额"],
      when: ["点击导出", "选择 CSV"],
      then: ["下载文件", "文件包含订单"],
    },
  ];

  const parsed = parseGherkin(renderGherkin(scenarios));

  expect(parsed[0].title).toBe(scenarios[0].title);
  expect(parsed[0].given).toEqual(scenarios[0].given);
  expect(parsed[0].when).toEqual(scenarios[0].when);
  expect(parsed[0].then).toEqual(scenarios[0].then);
});
