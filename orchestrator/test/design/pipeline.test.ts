import { expect, test } from "vitest";
import { scanAntiPatterns } from "../../src/design/anti-pattern-scan.js";
import type { DesignSystem } from "../../src/design/design-system-store.js";
import { renderMasterCss, runDesignPipeline } from "../../src/design/pipeline.js";

test("runs brief through advice, master, css, and anti-pattern gate", () => {
  const result = runDesignPipeline("金融 银行 SaaS 落地页");

  expect(result.advice.styles.length).toBeGreaterThan(0);
  expect(result.master.palette).toBeDefined();
  expect(result.masterMd).toContain("设计系统 MASTER");
  expect(result.css).toContain(":root");
  expect(result.css).toContain("--primary");
  expect(Array.isArray(result.antiPatternHits)).toBe(true);
  expect(result.antiPatternHits).toHaveLength(0);
});

test("renders starter css tokens and remains clean under anti-pattern scan", () => {
  const master: DesignSystem = {
    style: "企业稳健 Corporate",
    palette: { primary: "#0f3d3e", secondary: "#1e6f6f", cta: "#c8a24a" },
    fonts: { serif: "Lora", sans: "Source Sans 3" },
    antiPatterns: [],
  };
  const css = renderMasterCss(master);

  expect(css).toContain("--primary:");
  expect(css).toContain("--font-sans");
  expect(scanAntiPatterns({ css })).toHaveLength(0);
});

test("empty brief returns an empty-advice pipeline result without throwing", () => {
  const result = runDesignPipeline("");

  expect(result.advice.styles).toEqual([]);
  expect(result.advice.palettes).toEqual([]);
  expect(result.advice.fonts).toEqual([]);
  expect(result.master.antiPatterns).toHaveLength(9);
  expect(result.css).toContain(":root");
});
