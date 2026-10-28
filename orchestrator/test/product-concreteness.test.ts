import { expect, test } from "vitest";
import { assessConcreteness } from "../src/product/concreteness.js";
import type { ProductDefinition } from "../src/product/contract.js";

const concreteDefinition: ProductDefinition = {
  idea: "跨境订单核对",
  problem: "跨境小卖家每天手动核对200条订单耗时2小时",
  users: ["跨境小卖家"],
  stories: ["作为跨境小卖家，我要在发货前快速发现订单金额差异"],
  acceptance: ["导入200条订单后能标出金额不一致的订单"],
  jobStatement: "当跨境小卖家每天发货前核对订单时，需要快速发现金额差异，以便减少错发漏发。",
  nonGoals: ["不做全渠道 ERP"],
};

test("套话+无客户的定义不通过", () => {
  const result = assessConcreteness({ idea: "x", problem: "提升效率", users: [], stories: [], acceptance: [] });

  expect(result.pass).toBe(false);
  expect(result.issues.some((issue) => issue.field === "problem")).toBe(true);
  expect(result.issues.some((issue) => issue.field === "users")).toBe(true);
});

test("具体且齐全的定义通过", () => {
  const result = assessConcreteness(concreteDefinition);

  expect(result.pass).toBe(true);
  expect(result.score).toBeGreaterThanOrEqual(85);
});

test("仅缺 jobStatement/nonGoals 仍通过(软门)", () => {
  const result = assessConcreteness({
    idea: "跨境订单核对",
    problem: "跨境小卖家每天手动核对200条订单耗时2小时",
    users: ["跨境小卖家"],
    stories: ["作为跨境小卖家，我要在发货前快速发现订单金额差异"],
    acceptance: ["导入200条订单后能标出金额不一致的订单"],
  });

  expect(result.pass).toBe(true);
  expect(result.issues.some((issue) => issue.field === "jobStatement")).toBe(true);
  expect(result.issues.some((issue) => issue.field === "nonGoals")).toBe(true);
});
