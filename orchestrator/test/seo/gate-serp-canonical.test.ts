import { describe, expect, test } from "vitest";
import { normalizeSerpUrl, runSerpBudgetGate } from "../../src/seo/gates/serp-budget.js";

const ORIGIN = "https://demo-travel.ai";
const page = (url: string, head: string) => ({ url: `${ORIGIN}${url}`, html: `<html><head>${head}</head><body><h1>x</h1></body></html>` });
const desc = (n: number) => `<meta name="description" content="${"d".repeat(n)}">`;
const og = `<meta property="og:image" content="/og.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`;
const canon = (href: string) => `<link rel="canonical" href="${href}">`;
const SUPPORT = `<title>Help and visitor support | DemoTravel</title>${desc(120)}${og}`;
const SEARCH = `<title>Search the library | DemoTravel</title><meta name="description" content="${"s".repeat(100)}">${og}`;

describe("D7 SERP 门识别已归一变体(作者锁定)", () => {
  test("normalizeSerpUrl:相对路径按页面解析,去 hash 与尾斜杠,非 http 返回 null", () => {
    expect(normalizeSerpUrl("/support", `${ORIGIN}/support?service=a`)).toBe(`${ORIGIN}/support`);
    expect(normalizeSerpUrl(`${ORIGIN}/x/#top`, ORIGIN)).toBe(`${ORIGIN}/x`);
    expect(normalizeSerpUrl(`${ORIGIN}/`, ORIGIN)).toBe(`${ORIGIN}/`);
    expect(normalizeSerpUrl("mailto:a@demo-travel.ai", ORIGIN)).toBeNull();
    expect(normalizeSerpUrl("http://[bad", ORIGIN)).toBeNull();
  });

  test("canonical 指向别处或 noindex 的页:不进重复组、不算预算,只记 info;真重复仍红", () => {
    const r = runSerpBudgetGate([
      page("/support", `${SUPPORT}${canon(`${ORIGIN}/support`)}`),
      page("/support?service=arrival", `${SUPPORT}${canon("/support")}`),
      page("/support?service=route", `${SUPPORT}${canon(`${ORIGIN}/support/`)}`),
      page("/search", `${SEARCH}${canon(`${ORIGIN}/search`)}`),
      page("/search?q=payments", `${SEARCH}${canon(`${ORIGIN}/search`)}<meta name="robots" content="noindex, follow">`),
      page("/tips", `<title>Very long title that would blow the sixty character budget for sure</title>${desc(120)}${og}<meta name="googlebot" content="NOINDEX">`),
      page("/dup-a", `<title>Same title twice | DemoTravel</title>${desc(120)}${og}`),
      page("/dup-b", `<title>Same title twice | DemoTravel</title>${desc(120)}${og}`),
    ]);
    expect(r.variants).toEqual([
      { url: `${ORIGIN}/support?service=arrival`, canonical: `${ORIGIN}/support`, noindex: false },
      { url: `${ORIGIN}/support?service=route`, canonical: `${ORIGIN}/support`, noindex: false },
      { url: `${ORIGIN}/search?q=payments`, canonical: `${ORIGIN}/search`, noindex: true },
      { url: `${ORIGIN}/tips`, canonical: null, noindex: true },
    ]);
    expect(r.pages.map((p) => p.canonicalized)).toEqual([false, true, true, false, true, true, false, false]);
    expect(r.pages[0]).toMatchObject({ canonical: `${ORIGIN}/support`, noindex: false, canonicalized: false });
    expect(r.duplicateTitles).toEqual([{ key: "same title twice | demotravel", urls: [`${ORIGIN}/dup-a`, `${ORIGIN}/dup-b`] }]);
    expect(r.duplicateDescriptions).toEqual([{ key: "d".repeat(120), urls: [`${ORIGIN}/support`, `${ORIGIN}/dup-a`, `${ORIGIN}/dup-b`] }]);
    expect(r.findings.map((f) => [f.rule, f.severity])).toEqual([
      ["serp-canonical-variant", "info"],
      ["serp-canonical-variant", "info"],
      ["serp-canonical-variant", "info"],
      ["serp-canonical-variant", "info"],
      ["serp-title-duplicate", "error"],
      ["serp-description-duplicate", "warn"],
    ]);
    expect(r.findings[0].evidence).toBe(`${ORIGIN}/support`);
    expect(r.findings[0].message).toContain(`${ORIGIN}/support?service=arrival`);
    expect(r.findings[3].evidence).toBe("noindex");
    expect(r.ok).toBe(false);
  });

  test("只剩归一变体与自指 canonical 时 → 绿", () => {
    const r = runSerpBudgetGate([
      page("/support", `${SUPPORT}${canon(`${ORIGIN}/support`)}`),
      page("/support?service=arrival", `${SUPPORT}${canon("/support")}`),
      page("/search", `${SEARCH}${canon(`${ORIGIN}/search#frag`)}`),
      page("/search?q=x", `${SEARCH}${canon("/search")}`),
    ]);
    expect(r.ok).toBe(true);
    expect(r.findings.filter((f) => f.severity !== "info")).toEqual([]);
    expect(r.variants.map((v) => v.url)).toEqual([`${ORIGIN}/support?service=arrival`, `${ORIGIN}/search?q=x`]);
    expect(r.duplicateTitles).toEqual([]);
    expect(r.duplicateDescriptions).toEqual([]);
  });
});