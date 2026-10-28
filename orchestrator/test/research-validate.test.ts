import { expect, test } from "vitest";
import { validateFindings } from "../src/research/validate.js";
import type { ResearchFinding } from "../src/research/types.js";

test("带真实 http 来源放行；无来源拒收并附正确 reason", () => {
  const withSource: ResearchFinding = {
    topic: "NodeNext 后缀",
    source: "https://nodejs.org/api/esm.html",
    summary: "ESM 相对导入需带 .js 后缀。",
    suggestedConvention: "导入一律带 .js 后缀",
  };
  const noSource: ResearchFinding = {
    topic: "编造来源",
    source: "",
    summary: "没有来源的发现。",
  };

  const { valid, rejected } = validateFindings([withSource, noSource]);

  expect(valid).toEqual([withSource]);
  expect(rejected).toEqual([
    { finding: noSource, reason: "无可信来源 url（防编造来源）" },
  ]);
});
