import { expect, test } from "vitest";
import {
  buildScale,
  buildSemantic,
  contrastRatio,
  hexToOklch,
  oklchToHex,
  relLuminance,
  solveFg,
  toDTCG,
} from "../../src/design/color-engine.js";

const semanticKeys = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "border",
  "input",
  "ring",
];

function rgbChannels(hex: string): number[] {
  const s = hex.toLowerCase();
  const full =
    s.length === 4
      ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`
      : s;
  return [full.slice(1, 3), full.slice(3, 5), full.slice(5, 7)].map((part) => Number.parseInt(part, 16));
}

function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

test("computes WCAG contrast ratio endpoints", () => {
  expect(contrastRatio("#000000", "#ffffff")).toBeGreaterThanOrEqual(20.9);
  expect(contrastRatio("#000000", "#ffffff")).toBeLessThanOrEqual(21.1);
  expect(contrastRatio("#ffffff", "#ffffff")).toBeGreaterThanOrEqual(0.99);
  expect(contrastRatio("#ffffff", "#ffffff")).toBeLessThanOrEqual(1.01);
});

test("round trips sRGB through OKLCH within a small channel tolerance", () => {
  for (const hex of ["#2563eb", "#1f8a55", "#E2620E", "#1b1714"]) {
    const actual = rgbChannels(oklchToHex(hexToOklch(hex)));
    const expected = rgbChannels(hex);
    for (let i = 0; i < 3; i += 1) {
      expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(4);
    }
  }
});

test("builds 12-step light and dark scales with descending light luminance", () => {
  const scale = buildScale("#2563eb");
  expect(scale.light).toHaveLength(12);
  expect(scale.dark).toHaveLength(12);
  expect(relLuminance(scale.light[0])).toBeGreaterThan(relLuminance(scale.light[11]));
});

test("solves readable foreground colors for light and dark backgrounds", () => {
  const lightFg = solveFg("#ffffff");
  const darkFg = solveFg("#1b1714");
  expect(lightFg.toLowerCase()).not.toBe("#000000");
  expect(darkFg.toLowerCase()).not.toBe("#ffffff");
  expect(contrastRatio(lightFg, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(darkFg, "#1b1714")).toBeGreaterThanOrEqual(4.5);
});

test("builds shadcn-aligned semantic tokens with readable foregrounds", () => {
  const semantic = buildSemantic(buildScale("#2563eb"));

  for (const key of semanticKeys) {
    expect(semantic.light).toHaveProperty(key);
    expect(semantic.dark).toHaveProperty(key);
  }

  expect(contrastRatio(semantic.light.foreground, semantic.light.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(semantic.light["primary-foreground"], semantic.light.primary)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(semantic.dark.foreground, semantic.dark.background)).toBeGreaterThanOrEqual(4.5);
});

test("builds complementary accent with readable accent foreground", () => {
  const semantic = buildSemantic(buildScale("#E2620E"));
  const light = semantic.light;

  expect(light.accent).toMatch(/^#[0-9a-f]{6}$/);
  expect(hueDistance(hexToOklch(light.accent).h, hexToOklch(light.primary).h)).toBeGreaterThan(90);
  expect(light["accent-foreground"]).toBeDefined();
  expect(contrastRatio(light["accent-foreground"], light.accent)).toBeGreaterThanOrEqual(4.5);
});

test("converts semantic tokens to W3C DTCG color token shape", () => {
  const dtcg = toDTCG(buildSemantic(buildScale("#2563eb"))) as {
    light?: Record<string, unknown>;
    dark?: Record<string, unknown>;
  };
  expect(dtcg.light).toBeDefined();
  expect(dtcg.dark).toBeDefined();
  expect(dtcg.light?.background).toEqual({ $type: "color", $value: expect.stringMatching(/^#[0-9a-f]{6}$/) });
});
