import { expect, test } from "vitest";
import type { ProductDefinition } from "../src/product/contract.js";
import { buildStoryMap } from "../src/product/story-map.js";

function productDefinition(overrides: Partial<ProductDefinition> = {}): ProductDefinition {
  return {
    idea: "项目协作",
    problem: "交付过程不清晰",
    users: ["项目经理"],
    stories: ["查看项目"],
    acceptance: ["用户能查看项目状态"],
    nonGoals: ["不做资源排期"],
    ...overrides,
  };
}

test("backbone 来自 stories", () => {
  const stories = ["浏览", "下单", "支付"];
  const map = buildStoryMap(productDefinition({ stories }));

  expect(map.backbone).toEqual(stories);
});

test("走骨架切片 isWalkingSkeleton + 任务来自验收", () => {
  const map = buildStoryMap(productDefinition({ acceptance: ["用户能一键导出CSV"] }));

  expect(map.slices[0]?.isWalkingSkeleton).toBe(true);
  expect(map.slices[0]?.tasks).toHaveLength(1);
  expect(map.slices[0]?.tasks[0]?.scenarios.length).toBeGreaterThan(0);
});

test("里程碑含走骨架 + 每故事一条", () => {
  const map = buildStoryMap(productDefinition({ stories: ["浏览", "下单"] }));

  expect(map.milestones).toHaveLength(3);
  expect(map.milestones[0]).toContain("走骨架");
});

test("无验收→high 风险", () => {
  const map = buildStoryMap(productDefinition({ acceptance: [] }));

  expect(map.risks.some((risk) => risk.severity === "high" && risk.risk.includes("验收"))).toBe(true);
});

test("缺 Non-Goals→medium 风险", () => {
  const map = buildStoryMap(productDefinition({ nonGoals: undefined }));

  expect(map.risks.some((risk) => risk.severity === "medium" && risk.risk.includes("Non-Goals"))).toBe(true);
});

test("故事过多/用户过宽触发风险", () => {
  const map = buildStoryMap(
    productDefinition({
      stories: ["S1", "S2", "S3", "S4", "S5", "S6"],
      users: ["U1", "U2", "U3", "U4"],
    }),
  );

  expect(map.risks.some((risk) => risk.risk.includes("故事过多"))).toBe(true);
  expect(map.risks.some((risk) => risk.risk.includes("目标用户过宽"))).toBe(true);
});

test("健康定义无 high 风险", () => {
  const map = buildStoryMap(
    productDefinition({
      acceptance: ["用户能查看项目状态"],
      nonGoals: ["不做资源排期"],
      stories: ["查看项目", "跟进风险"],
      users: ["项目经理", "负责人"],
    }),
  );

  expect(map.risks.some((risk) => risk.severity === "high")).toBe(false);
});
