import { expect, test } from "vitest";
import { tokenize } from "../../src/knowledge/tokenize.js";

test("tokenizes mixed Chinese and English text into lowercase word tokens", () => {
  const tokens = tokenize("AI产品的护城河");

  expect(tokens).toContain("ai");
  expect(tokens).toContain("产品");
  expect(tokens).toContain("护城河");
});

test("returns empty tokens for empty, whitespace, and punctuation-only input", () => {
  expect(tokenize("")).toEqual([]);
  expect(tokenize("   \n\t  ")).toEqual([]);
  expect(tokenize("，。！？,.!?")).toEqual([]);
});
