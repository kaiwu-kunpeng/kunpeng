import { expect, test } from "vitest";
import { apcaLc } from "../../src/design/apca.js";
import { solveFg } from "../../src/design/color-engine.js";

test("computes APCA Lc endpoints", () => {
  expect(apcaLc("#000000", "#ffffff")).toBeGreaterThanOrEqual(104.5);
  expect(apcaLc("#000000", "#ffffff")).toBeLessThanOrEqual(107.5);
  expect(apcaLc("#ffffff", "#000000")).toBeGreaterThanOrEqual(-109.5);
  expect(apcaLc("#ffffff", "#000000")).toBeLessThanOrEqual(-106.5);
});

test("returns zero for equal colors", () => {
  expect(apcaLc("#808080", "#808080")).toBe(0);
});

test("uses positive Lc for dark text on light backgrounds and negative Lc for light text on dark backgrounds", () => {
  expect(apcaLc("#222222", "#ffffff")).toBeGreaterThan(0);
  expect(apcaLc("#ffffff", "#1e293b")).toBeLessThan(0);
});

test("solves APCA-readable foreground colors without returning pure black", () => {
  for (const bg of ["#ffffff", "#1e293b", "#E2620E"]) {
    const fg = solveFg(bg);
    expect(fg.toLowerCase()).not.toBe("#000000");
    expect(Math.abs(apcaLc(fg, bg))).toBeGreaterThanOrEqual(60);
  }
});
