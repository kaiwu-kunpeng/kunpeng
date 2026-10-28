import { expect, test } from "vitest";

import { getAnchor } from "../../src/design/design-anchors.js";
import { suggestDesign } from "../../src/design/design-suggest.js";

test("suggests finance seed color and a valid anchor when available", () => {
  const suggestion = suggestDesign("金融 银行 稳重 仪表盘");

  expect(suggestion.seedHex).toMatch(/^#[0-9a-fA-F]{6}$/);
  if (suggestion.anchor) {
    expect(getAnchor(suggestion.anchor)).toBeDefined();
  }
});

test("maps beauty spa soft UI knowledge to the Organic anchor", () => {
  const suggestion = suggestDesign("美妆 水疗 优雅 官网");

  expect(suggestion.anchor).toBe("Organic");
  expect(suggestion.seedHex).toBeDefined();
});

test("maps brutalist personal brand knowledge to the Brutalist anchor", () => {
  const suggestion = suggestDesign("粗野 创意 个人品牌");

  expect(suggestion.anchor).toBe("Brutalist");
});

test("returns empty suggestion fields for an empty query", () => {
  expect(() => suggestDesign("")).not.toThrow();
  expect(suggestDesign("")).toEqual({
    seedHex: undefined,
    anchor: undefined,
    styleName: undefined,
  });
});
