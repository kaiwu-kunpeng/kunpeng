import { expect, test } from "vitest";

import {
  composeDesignSystemPrompt,
  PROPRIETARY_DESIGN_RULES,
} from "../../src/design/design-prompt.js";

test("proprietary design rules contain required anchors", () => {
  for (const anchor of [
    "#F4F1EA",
    "acid-green",
    "broadsheet",
    "signature",
    "4.5",
    "44px",
    "emoji",
    "紫蓝渐变",
    "中英",
    "inline style",
    "自造",
  ]) {
    expect(PROPRIETARY_DESIGN_RULES).toContain(anchor);
  }
});

test("composeDesignSystemPrompt combines baseline and proprietary rules without optional sections", () => {
  const prompt = composeDesignSystemPrompt({ baseline: "BASE_X" });

  expect(prompt).toContain("BASE_X");
  expect(prompt).toContain("#F4F1EA");
  expect(prompt).not.toContain("本次设计 BRIEF");
  expect(prompt).not.toContain("本次风格锚");
});

test("composeDesignSystemPrompt includes brief and anchor sections when provided", () => {
  const prompt = composeDesignSystemPrompt({
    baseline: "BASE_X",
    brief: "GOAL_Y",
    anchor: "Swiss",
  });

  expect(prompt).toContain("GOAL_Y");
  expect(prompt).toContain("Swiss");
  expect(prompt).toContain("本次设计 BRIEF");
  expect(prompt).toContain("本次风格锚");
});

test("composeDesignSystemPrompt includes reference migration guidance when provided", () => {
  const prompt = composeDesignSystemPrompt({ baseline: "B", reference: "REF_X" });

  expect(prompt).toContain("REF_X");
  expect(prompt).toContain("参考");
});

test("composeDesignSystemPrompt omits reference migration guidance by default", () => {
  const prompt = composeDesignSystemPrompt({ baseline: "B" });

  expect(prompt).not.toContain("参考(风格迁移");
});

test("composeDesignSystemPrompt injects brand truth before proprietary rules", () => {
  const prompt = composeDesignSystemPrompt({ baseline: "BASE", brand: "BRAND_X" });

  expect(prompt).toContain("BRAND_X");
  expect(prompt).toContain("品牌");

  const brandIndex = prompt.indexOf("# 品牌");
  const proprietaryIndex = prompt.indexOf("# 鲲鹏专有设计规则");

  expect(brandIndex).toBeGreaterThanOrEqual(0);
  expect(proprietaryIndex).toBeGreaterThanOrEqual(0);
  expect(brandIndex).toBeLessThan(proprietaryIndex);
});

test("composeDesignSystemPrompt omits brand section by default", () => {
  const prompt = composeDesignSystemPrompt({ baseline: "BASE" });

  expect(prompt).not.toContain("# 品牌(单一真相");
});

test("composeDesignSystemPrompt keeps baseline before proprietary rules", () => {
  const prompt = composeDesignSystemPrompt({
    baseline: "BASE_X",
    brief: "GOAL_Y",
    anchor: "Swiss",
  });

  const baselineIndex = prompt.indexOf("# 设计基线");
  const proprietaryIndex = prompt.indexOf("# 鲲鹏专有设计规则");

  expect(baselineIndex).toBeGreaterThanOrEqual(0);
  expect(proprietaryIndex).toBeGreaterThanOrEqual(0);
  expect(baselineIndex).toBeLessThan(proprietaryIndex);
});
