import { describe, it, expect } from "vitest";
import { seoHintsFrom, qaVerdict } from "../../src/product/browser-qa.js";
import { renderQaEvidence } from "../../src/server/ui/views/project.js";

describe("seoHintsFrom", () => {
  it("全缺 → 七条提示", () => {
    const hints = seoHintsFrom({ h1Count: 0 });
    expect(hints.length).toBe(7);
    expect(hints.some((h) => h.includes("title"))).toBe(true);
    expect(hints.some((h) => h.includes("H1"))).toBe(true);
  });

  it("全齐 → 零提示；title 超长单独报", () => {
    const ok = seoHintsFrom({ title: "好标题", metaDescription: "描述", h1Count: 1, ogTitle: true, canonical: true, jsonLd: true });
    expect(ok).toEqual([]);
    const long = seoHintsFrom({ title: "长".repeat(61), metaDescription: "d", h1Count: 1, ogTitle: true, canonical: true, jsonLd: true });
    expect(long.length).toBe(1);
    expect(long[0]).toContain("过长");
  });
});

describe("SEO 提示不影响 QA 裁决", () => {
  it("有 seoHints 但零 problems 时 ok 仍为 true", () => {
    const v = qaVerdict({ status: 200, bodyTextLength: 300, consoleErrors: [], interactiveCount: 3, seoHints: ["缺 og:title"] });
    expect(v.ok).toBe(true);
    expect(v.problems).toEqual([]);
  });
});

describe("证据块渲染", () => {
  it("seoHints 上屏为独立块，失败块不受影响", () => {
    const html = renderQaEvidence({ ok: true, problems: [], seoHints: ["缺 meta description", "缺 H1"] });
    expect(html).toContain("seo-hints");
    expect(html).toContain("SEO 提示");
    expect(html).toContain("缺 H1");
  });
});