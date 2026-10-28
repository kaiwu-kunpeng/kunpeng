import { expect, test } from "vitest";
import { formatSuggestions } from "../src/project/scout-format.js";
import type { ResearchFinding } from "../src/research/types.js";

test("空发现 → 占位行 + 项目名/生成时间", () => {
  const md = formatSuggestions("kunpeng", [], "2026-06-19");
  expect(md).toContain("# kunpeng · 研究建议");
  expect(md).toContain("2026-06-19");
  expect(md).toContain("（本轮无新发现）");
});

test("全字段发现 → 渲染 topic/摘要/来源/建议约定/建议升级", () => {
  const fs: ResearchFinding[] = [{
    topic: "AGENTS.md 生态", source: "https://example.com/a", summary: "S1",
    suggestedConvention: "C1", suggestedUpgrade: "U1",
  }];
  const md = formatSuggestions("kunpeng", fs, "2026-06-19");
  expect(md).toContain("## AGENTS.md 生态");
  expect(md).toContain("摘要：S1");
  expect(md).toContain("来源：https://example.com/a");
  expect(md).toContain("建议约定：C1");
  expect(md).toContain("建议升级：U1");
});

test("缺可选字段 → 不出现建议约定/建议升级行;多发现保序", () => {
  const fs: ResearchFinding[] = [
    { topic: "T-first", source: "s1", summary: "m1" },
    { topic: "T-second", source: "s2", summary: "m2" },
  ];
  const md = formatSuggestions("p", fs, "t");
  expect(md).not.toContain("建议约定");
  expect(md).not.toContain("建议升级");
  expect(md.indexOf("T-first")).toBeLessThan(md.indexOf("T-second"));
});
