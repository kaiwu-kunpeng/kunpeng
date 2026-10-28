import { expect, test } from "vitest";
import type { ProductDefinition } from "../src/product/contract.js";
import { buildCritiquePrompt, critiqueDefinition } from "../src/product/pm-critic.js";

function baseDefinition(overrides: Partial<ProductDefinition> = {}): ProductDefinition {
  return {
    idea: "跨境订单核对",
    problem: "跨境小卖家每天手动核对200条订单耗时2小时",
    users: ["跨境小卖家", "运营助理"],
    stories: [
      "作为跨境小卖家，我要在发货前快速发现订单金额差异",
      "作为运营助理，我要导出异常订单清单",
      "作为跨境小卖家，我要看到每日核对结果",
    ],
    acceptance: ["导入200条订单后能标出金额不一致的订单", "能导出异常订单CSV", "能显示每日核对摘要"],
    jobStatement: "当跨境小卖家每天发货前核对订单时，需要快速发现金额差异，以便减少错发漏发。",
    nonGoals: ["不做全渠道 ERP"],
    ...overrides,
  };
}

test("缺 Non-Goals 的定义给 revise", () => {
  const critique = critiqueDefinition(baseDefinition({ nonGoals: [] }));

  expect(critique.verdict).toBe("revise");
  expect(critique.findings.some((finding) => finding.category === "non-goals")).toBe(true);
  expect(critique.requiresHumanGate).toBe(true);
});

test("无验收给 block", () => {
  const critique = critiqueDefinition(baseDefinition({ acceptance: [] }));

  expect(critique.verdict).toBe("block");
});

test("故事过多触发 scope-creep warn", () => {
  const critique = critiqueDefinition(
    baseDefinition({
      stories: [
        "故事1",
        "故事2",
        "故事3",
        "故事4",
        "故事5",
        "故事6",
        "故事7",
        "故事8",
      ],
    }),
  );

  expect(critique.findings.some((finding) => finding.category === "scope-creep")).toBe(true);
});

test("全P0：故事多验收单一触发 priority warn", () => {
  const critique = critiqueDefinition(
    baseDefinition({
      stories: ["故事1", "故事2", "故事3", "故事4"],
      acceptance: ["完成核心验收"],
    }),
  );

  expect(critique.findings.some((finding) => finding.category === "priority")).toBe(true);
});

test("健康定义 pass", () => {
  const critique = critiqueDefinition(baseDefinition());

  expect(critique.verdict).toBe("pass");
  expect(critique.requiresHumanGate).toBe(false);
  expect(critique.findings).toEqual([]);
});

test("buildCritiquePrompt 含红队/verdict/JSON 锚", () => {
  const prompt = buildCritiquePrompt(baseDefinition());

  expect(prompt).toContain("红队");
  expect(prompt).toContain("verdict");
  expect(prompt).toContain("JSON");
});
