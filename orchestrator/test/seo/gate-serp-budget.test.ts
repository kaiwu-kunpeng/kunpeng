import { describe, expect, test } from "vitest";
import { clipTitle, rawTitle, runSerpBudgetGate } from "../../src/seo/gates/serp-budget.js";

const ORIGIN = "https://demo-travel.ai";
const page = (url: string, head: string) => ({ url: `${ORIGIN}${url}`, html: `<html><head>${head}</head><body><h1>x</h1></body></html>` });
const desc = (n: number) => `<meta name="description" content="${"d".repeat(n)}">`;
const og = (src: string, w?: number, h?: number) =>
  `<meta property="og:image" content="${src}">${w === undefined ? "" : `<meta property="og:image:width" content="${w}">`}${h === undefined ? "" : `<meta property="og:image:height" content="${h}">`}`;

const GOOD = page("/good", `<title>Alipay setup for foreign visitors | DemoTravel</title>${desc(120)}${og("/og.jpg", 1200, 630)}`);

describe("D7 SERP 行预算门(作者锁定)", () => {
  test("rawTitle 只量原文:不解码实体,折叠空白;clipTitle 按码点裁", () => {
    expect(rawTitle("<html><head><title>  Metro &amp;\n  taxi  </title></head></html>")).toBe("Metro &amp; taxi");
    expect(rawTitle("<html><head></head></html>")).toBeNull();
    expect(rawTitle("<title></title>")).toBeNull();
    expect(clipTitle("北京地铁与出租车指南", 4)).toBe("北京地铁");
  });

  test("好页面:无 finding,报告字段齐全", () => {
    const r = runSerpBudgetGate([GOOD]);
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual([]);
    expect(r.pages[0]).toEqual({
      url: `${ORIGIN}/good`,
      title: "Alipay setup for foreign visitors | DemoTravel",
      titleLength: 46,
      titleClipped: "Alipay setup for foreign visitors | DemoTravel",
      description: "d".repeat(120),
      descriptionLength: 120,
      ogImage: "/og.jpg",
      ogWidth: 1200,
      ogHeight: 630,
      canonical: null,
      noindex: false,
      canonicalized: false,
    });
    expect(r.variants).toEqual([]);
    expect(r.duplicateTitles).toEqual([]);
    expect(r.duplicateDescriptions).toEqual([]);
  });

  test("变异:实体让标题超预算(解码后 57,原文 61) → 红", () => {
    const title = `Metro &amp; taxi fares in Shanghai for foreign visitors 2026x`;
    expect([...title].length).toBe(61);
    const r = runSerpBudgetGate([page("/entity", `<title>${title}</title>${desc(120)}${og("/og.jpg", 1200, 630)}`)]);
    expect(r.ok).toBe(false);
    expect(r.findings).toEqual([{ rule: "serp-title-over-budget", severity: "error", message: expect.stringContaining("61"), evidence: title }]);
    expect(r.findings[0].message).toContain("60");
    expect(r.findings[0].message).toContain(`${ORIGIN}/entity`);
    expect(r.pages[0].titleClipped).toBe(clipTitle(title, 60));
  });

  test("逐页 warn/info:缺描述、描述短、描述超、缺 og、og 尺寸未知、og 尺寸不合格", () => {
    const r = runSerpBudgetGate([
      page("/a", `<title>Short title page A of DemoTravel</title>${og("/a.jpg", 1200, 630)}`),
      page("/b", `<title>Short title page B of DemoTravel</title>${desc(30)}${og("/b.jpg")}`),
      page("/c", `<title>Short title page C of DemoTravel</title>${desc(170)}${og("/c.jpg", 800, 600)}`),
      page("/d", `<title>Short title page D of DemoTravel</title>${desc(120)}`),
      page("/e", `<title>Short title page E of DemoTravel</title>${desc(121)}${og("/e.jpg", 1600, 400)}`),
    ]);
    expect(r.ok).toBe(true);
    expect(r.findings.map((f) => [f.rule, f.severity])).toEqual([
      ["serp-description-missing", "warn"],
      ["serp-description-short", "warn"],
      ["serp-og-image-unknown-size", "info"],
      ["serp-description-over-budget", "warn"],
      ["serp-og-image-size", "warn"],
      ["serp-og-image-missing", "warn"],
      ["serp-og-image-size", "warn"],
    ]);
    expect(r.findings[1].message).toContain("30");
    expect(r.findings[4].evidence).toBe("800x600");
    expect(r.findings[6].evidence).toBe("1600x400");
    expect(r.pages[1].ogWidth).toBeNull();
  });

  test("变异:裁后重复标题 → 红(超预算也各自红);重复描述 → warn;缺标题 → 红;阈值可调", () => {
    const base = "Shanghai metro and taxi fares for first-time foreign visitors: the";
    const r = runSerpBudgetGate([
      page("/x", `<title>${base} 2025 edition</title>${desc(120)}${og("/o.jpg", 1200, 630)}`),
      page("/y", `<title>${base} 2026 edition</title>${desc(120)}${og("/o.jpg", 1200, 630)}`),
      page("/z", `${desc(120)}${og("/o.jpg", 1200, 630)}`),
    ], { titleMax: 70 });
    expect(r.ok).toBe(false);
    expect(r.duplicateTitles).toEqual([{ key: `${base} 202`.toLowerCase(), urls: [`${ORIGIN}/x`, `${ORIGIN}/y`] }]);
    expect(r.duplicateDescriptions).toEqual([{ key: "d".repeat(120), urls: [`${ORIGIN}/x`, `${ORIGIN}/y`, `${ORIGIN}/z`] }]);
    expect(r.findings.map((f) => f.rule)).toEqual([
      "serp-title-over-budget", "serp-title-over-budget", "serp-title-missing", "serp-title-duplicate", "serp-description-duplicate",
    ]);
    expect(r.findings[3]).toMatchObject({ severity: "error", evidence: `${ORIGIN}/x, ${ORIGIN}/y` });
    expect(r.findings[3].message).toContain(`${base} 202`.toLowerCase());
    expect(r.findings[4].severity).toBe("warn");
    const wide = runSerpBudgetGate([
      page("/x", `<title>${base} 2025 edition</title>${desc(120)}${og("/o.jpg", 1200, 630)}`),
      page("/y", `<title>${base} 2026 edition</title>${desc(120)}${og("/o.jpg", 1200, 630)}`),
    ], { titleMax: 90 });
    expect(wide.duplicateTitles).toEqual([]);
    expect(wide.findings.map((f) => f.rule)).toEqual(["serp-description-duplicate"]);
  });
});