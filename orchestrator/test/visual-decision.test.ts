import { expect, test } from "vitest";
import { decideVisual } from "../src/verify/visual-decision.js";

test("0.5% diff exceeds default 0.1% tolerance → withinTolerance false", () => {
  const { ratio, withinTolerance } = decideVisual(5, 1000);
  expect(ratio).toBe(0.005);
  expect(withinTolerance).toBe(false);
});

test("0.1% diff within overridden 1% tolerance → withinTolerance true", () => {
  const { withinTolerance } = decideVisual(1, 1000, { maxDiffRatio: 0.01 });
  expect(withinTolerance).toBe(true);
});

test("boundary equal to tolerance counts as within (<=)", () => {
  const { withinTolerance } = decideVisual(1, 1000); // 0.001 === default
  expect(withinTolerance).toBe(true);
});

test("totalPixels 0 → ratio 0, no NaN/Infinity", () => {
  const { ratio, withinTolerance } = decideVisual(0, 0);
  expect(ratio).toBe(0);
  expect(Number.isFinite(ratio)).toBe(true);
  expect(withinTolerance).toBe(true);
});
