import { expect, test } from "vitest";
import { ANTI_PATTERNS, searchDesignKnowledge } from "../../src/design/knowledge.js";

test("recommends spa and beauty design knowledge", () => {
  const advice = searchDesignKnowledge("美妆水疗 spa 优雅");

  expect(advice.styles.map((style) => style.id)).toContain("soft-ui");
  expect(advice.styles[0]?.id).toBe("soft-ui");
  expect(advice.palettes.map((palette) => palette.industry)).toContain("美妆水疗");
  expect(advice.fonts.map((font) => font.id)).toContain("elegant");
  expect(advice.antiPatterns).toHaveLength(9);
});

test("recommends finance and banking design knowledge", () => {
  const advice = searchDesignKnowledge("金融 银行 稳重");

  expect(advice.palettes.map((palette) => palette.industry)).toContain("金融银行");
  expect(advice.styles.map((style) => style.id)).toContain("corporate");
});

test("empty query returns only global anti-patterns", () => {
  const advice = searchDesignKnowledge("");

  expect(advice.styles).toEqual([]);
  expect(advice.palettes).toEqual([]);
  expect(advice.fonts).toEqual([]);
  expect(advice.antiPatterns).toHaveLength(9);
});

test("anti-patterns always include the purple gradient rule", () => {
  expect(ANTI_PATTERNS).toHaveLength(9);
  expect(searchDesignKnowledge("科技 AI dashboard").antiPatterns.map((rule) => rule.id)).toContain("no-purple-gradient");
});
