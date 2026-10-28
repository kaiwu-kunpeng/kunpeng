import { expect, test } from "vitest";

import {
  extractHexColors,
  nearestPaletteHex,
  offPaletteColors,
  paletteHexes,
  repeatedBlocks,
  renderReview,
  structuralRepeats,
} from "../../src/design/design-render-review.js";

test("extractHexColors normalizes, expands, and deduplicates HTML colors", () => {
  const colors = extractHexColors("a:#FFF;b:#2563eb;c:#2563EB");

  expect(colors).toContain("#ffffff");
  expect(colors).toContain("#2563eb");
  expect(colors.filter((color) => color === "#2563eb")).toHaveLength(1);
});

test("paletteHexes collects DTCG light and dark token values", () => {
  const colors = paletteHexes({
    light: { primary: { $value: "#9f2000" } },
    dark: { background: { $value: "#380600" } },
  });

  expect(colors).toContain("#9f2000");
  expect(colors).toContain("#380600");
});

test("offPaletteColors flags chromatic colors far from the palette", () => {
  expect(offPaletteColors("<i style='color:#39ff14'></i>", ["#9f2000", "#380600", "#ffffff"])).toContain("#39ff14");
});

test("offPaletteColors allows colors already in the palette", () => {
  expect(offPaletteColors("<i style='color:#9f2000'></i>", ["#9f2000"])).toEqual([]);
});

test("offPaletteColors exempts near-neutral gray even when absent from the palette", () => {
  expect(offPaletteColors("<i style='color:#1a1a1a'></i>", ["#9f2000"])).toEqual([]);
});

test("structuralRepeats counts h1 tags case-insensitively", () => {
  expect(structuralRepeats("<h1>a</h1><div></div><H1>b</H1><h1>c</h1>")).toBe(3);
});

test("nearestPaletteHex returns the closest palette color", () => {
  expect(["#9f2000", "#380600"]).toContain(nearestPaletteHex("#2f6f55", ["#9f2000", "#380600"]));
});

test("repeatedBlocks counts large repeated HTML blocks", () => {
  const block = `<section><div>${"重复内容".repeat(60)}</div></section>`;

  expect(repeatedBlocks(`${block}${block}${block}`)).toBeGreaterThanOrEqual(1);
});

test("repeatedBlocks ignores clean non-repeated HTML", () => {
  expect(repeatedBlocks("<main><section>Alpha</section><section>Beta</section><section>Gamma</section></main>")).toBe(0);
});

test("renderReview passes clean short HTML using one h1 and palette colors", () => {
  expect(
    renderReview("<section><h1>Title</h1><p style='color:#9f2000'>Copy</p></section>", {
      light: { primary: { $value: "#9f2000" } },
    }),
  ).toEqual({ pass: true, issues: [] });
});

test("renderReview fails prose narration that is not an HTML document", () => {
  const review = renderReview("已生成 index.html — 一份自包含的 16:9 pitch deck。核心决策 …", { light: {}, dark: {} });

  expect(review.pass).toBe(false);
  expect(review.issues.some((issue) => issue.includes("不是 HTML"))).toBe(true);
});

test("renderReview accepts standard HTML without non-HTML issue", () => {
  const review = renderReview("<!doctype html><html><head><style>:root{}</style></head><body><h1>x</h1></body></html>", {
    light: {},
    dark: {},
  });

  expect(review.pass).toBe(true);
  expect(review.issues.some((issue) => issue.includes("不是 HTML"))).toBe(false);
});

test("renderReview reports off-palette colors and repeated h1 structure", () => {
  const review = renderReview("<h1>A</h1><section style='color:#39ff14'><h1>B</h1><H1>C</H1></section>", {
    light: { primary: { $value: "#9f2000" } },
    dark: { background: { $value: "#380600" } },
  });

  expect(review.pass).toBe(false);
  expect(review.issues.length).toBeGreaterThanOrEqual(2);
  expect(review.issues.some((issue) => issue.includes("离调色板"))).toBe(true);
  expect(review.issues.some((issue) => issue.includes("建议"))).toBe(true);
  expect(review.issues.some((issue) => issue.includes("页面结构重复"))).toBe(true);
});

test("renderReview fails repeated large structure without h1 tags", () => {
  const block = `<section><p>${"重复版块".repeat(60)}</p></section>`;
  const review = renderReview(`<main>${block}${block}${block}</main>`, {
    light: { primary: { $value: "#9f2000" } },
  });

  expect(review.pass).toBe(false);
  expect(review.issues.some((issue) => issue.includes("大块重复"))).toBe(true);
});
