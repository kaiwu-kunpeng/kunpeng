import { describe, expect, test } from "vitest";
import { PAGE_AUDIT_RULES, auditPageHtml } from "../../src/seo/page-audit.js";

const URL_OK = "https://demo-travel.ai/guides/alipay-setup";

const GOOD = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Set up Alipay as a foreigner in China (2026 guide)</title>
<meta name="description" content="Step-by-step: link a foreign Visa or Mastercard to Alipay, pass identity verification, and pay for the metro and taxis within ten minutes of landing.">
<link rel="canonical" href="${URL_OK}">
<link rel="alternate" hreflang="en" href="${URL_OK}">
<link rel="alternate" hreflang="zh-Hans" href="https://demo-travel.ai/zh/guides/alipay-setup">
<link rel="alternate" hreflang="x-default" href="${URL_OK}">
</head>
<body>
<h1>Set up Alipay in China</h1>
<p>Landing in Shanghai with only a foreign card is fine. Alipay takes Visa and Mastercard now, and the metro accepts its QR code in every city we tested.</p>
<h2>Before you land</h2>
<p>Install the app and keep your passport nearby.</p>
<h3>Passport scan</h3>
<img src="/img/alipay-passport-scan.png" alt="Alipay passport verification screen">
<img src="/img/divider.svg" alt="">
<h2>At the metro gate</h2>
<a href="/guides/metro-qr">Metro QR guide</a>
<a href="https://demo-travel.ai/guides/taxi">Taxi</a>
<a href="https://example.org/alipay" rel="nofollow noopener">Official site</a>
<a href="#top">Top</a>
<a href="mailto:hi@demo-travel.ai">Mail</a>
<script>console.log("ignored words here")</script>
</body>
</html>`;

const BAD_URL = "https://demo-travel.ai/zh/bad";
const BAD = `<html>
<head>
<meta charset="gbk">
<meta name="description" content="${"x".repeat(170)}">
<link rel="canonical" href="/zh/bad">
<link rel="alternate" hreflang="en" href="https://demo-travel.ai/en/bad">
<link rel="alternate" hreflang="zh" href="https://demo-travel.ai/zh/other">
</head>
<body>
<h1>First</h1>
<h1>Second</h1>
<h2>Section</h2>
<h4>Skipped</h4>
<h3></h3>
<img src="/img/hero-photo.jpg" alt="hero photo">
<img src="/img/a.png">
<img src="/img/b.png">
<p>Broken text � here �</p>
</body>
</html>`;

describe("SEO 页面审计器(作者锁定)", () => {
  test("规则清单固定顺序", () => {
    expect([...PAGE_AUDIT_RULES]).toEqual([
      "title-missing", "title-length", "description-missing", "description-length",
      "h1-missing", "h1-multiple", "heading-skip", "heading-empty",
      "img-alt-missing", "img-alt-filename", "html-lang-missing",
      "canonical-missing", "canonical-relative", "noindex",
      "hreflang-no-x-default", "hreflang-self-missing",
      "mojibake", "charset-mismatch", "charset-missing",
    ]);
  });

  test("好页面:事实齐全、findings 为空", () => {
    const a = auditPageHtml(GOOD, { url: URL_OK, httpCharset: "UTF-8" });
    expect(a.findings).toEqual([]);
    expect(a.url).toBe(URL_OK);
    expect(a.lang).toBe("en");
    expect(a.charset).toBe("utf-8");
    expect(a.title).toEqual({ text: "Set up Alipay as a foreigner in China (2026 guide)", length: 50 });
    expect(a.description?.length).toBe(149);
    expect(a.canonical).toBe(URL_OK);
    expect(a.robots).toEqual({ noindex: false, nofollow: false });
    expect(a.headings).toEqual([
      { level: 1, text: "Set up Alipay in China" },
      { level: 2, text: "Before you land" },
      { level: 3, text: "Passport scan" },
      { level: 2, text: "At the metro gate" },
    ]);
    expect(a.h1Count).toBe(1);
    expect(a.images).toEqual({ total: 2, missingAlt: 0, emptyAlt: 1, altEqualsFilename: 0 });
    expect(a.hreflang).toEqual([
      { lang: "en", href: URL_OK },
      { lang: "zh-Hans", href: "https://demo-travel.ai/zh/guides/alipay-setup" },
      { lang: "x-default", href: URL_OK },
    ]);
    expect(a.links).toEqual({ internal: 2, external: 1, nofollow: 1 });
    expect(a.wordCount).toBe(58);
    expect(a.replacementChars).toBe(0);
  });

  test("坏页面:每条规则都抓得出来,顺序按规则表", () => {
    const a = auditPageHtml(BAD, { url: BAD_URL, httpCharset: "utf-8" });
    const rules = a.findings.map((f) => f.rule);
    expect(rules).toEqual([
      "title-missing", "description-length", "h1-multiple", "heading-skip", "heading-empty",
      "img-alt-missing", "img-alt-filename", "html-lang-missing", "canonical-relative",
      "hreflang-no-x-default", "hreflang-self-missing", "mojibake", "charset-mismatch",
    ]);
    const by = (rule: string) => a.findings.find((f) => f.rule === rule)!;
    expect(by("title-missing").severity).toBe("error");
    expect(by("h1-multiple").message).toContain("2");
    expect(by("heading-skip")).toMatchObject({ severity: "warn", evidence: "H2→H4" });
    expect(by("heading-empty").evidence).toBe("h3");
    expect(by("img-alt-missing")).toMatchObject({ severity: "warn", evidence: "/img/a.png, /img/b.png" });
    expect(by("img-alt-missing").message).toContain("2");
    expect(by("img-alt-filename").message).toContain("1");
    expect(by("html-lang-missing").severity).toBe("error");
    expect(by("mojibake")).toMatchObject({ severity: "error" });
    expect(by("mojibake").message).toContain("2");
    expect(by("charset-mismatch")).toMatchObject({ severity: "error", evidence: "meta=gbk http=utf-8" });
    expect(a.title).toBeNull();
    expect(a.lang).toBeNull();
    expect(a.charset).toBe("gbk");
    expect(a.h1Count).toBe(2);
    expect(a.images).toEqual({ total: 3, missingAlt: 2, emptyAlt: 0, altEqualsFilename: 1 });
    expect(a.replacementChars).toBe(2);
    expect(a.canonical).toBe("/zh/bad");
  });

  test("title 过长/过短、description 过短、h1 缺失、canonical 缺失、charset 双缺", () => {
    const html = `<html lang="fr"><head><title>${"t".repeat(61)}</title><meta name="description" content="short"></head><body><h2>Only h2</h2></body></html>`;
    const a = auditPageHtml(html, { url: "https://demo-travel.ai/fr" });
    expect(a.findings.map((f) => f.rule)).toEqual([
      "title-length", "description-length", "h1-missing", "canonical-missing", "charset-missing",
    ]);
    expect(a.findings[0].message).toContain("61");
    expect(a.title?.length).toBe(61);
    const shortTitle = auditPageHtml(`<html lang="fr"><head><title>Hi</title></head><body></body></html>`, { url: "https://demo-travel.ai/fr" });
    expect(shortTitle.findings.map((f) => f.rule)).toContain("title-length");
  });

  test("noindex 只是 info;http-equiv 也能取到 charset;hreflang 自指比较忽略末尾斜杠", () => {
    const html = `<html lang="de"><head>
<meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1">
<title>Reiseführer für Shanghai: Metro, Alipay und Taxi</title>
<meta name="description" content="${"d".repeat(120)}">
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="https://demo-travel.ai/de/">
<link rel="alternate" hreflang="de" href="https://demo-travel.ai/de/">
<link rel="alternate" hreflang="x-default" href="https://demo-travel.ai/">
</head><body><h1>Shanghai</h1></body></html>`;
    const a = auditPageHtml(html, { url: "https://demo-travel.ai/de", httpCharset: "iso-8859-1" });
    expect(a.charset).toBe("iso-8859-1");
    expect(a.robots).toEqual({ noindex: true, nofollow: false });
    expect(a.findings).toEqual([
      { rule: "noindex", severity: "info", message: expect.any(String) },
    ]);
  });

  test("装饰图 alt=\"\" 不算缺失;alt 与文件名的比较不分大小写与连字符", () => {
    const html = `<html lang="en"><head><meta charset="utf-8"><title>Alt attribute audit fixture page</title>
<meta name="description" content="${"d".repeat(120)}"><link rel="canonical" href="https://demo-travel.ai/alt"></head>
<body><h1>Alt</h1>
<img src="/a/b/Great_Wall-sunrise.JPG?v=2" alt="great wall sunrise">
<img src="/x.png" alt="  ">
<img src="/y.png" alt="A real description">
</body></html>`;
    const a = auditPageHtml(html, { url: "https://demo-travel.ai/alt", httpCharset: "utf-8" });
    expect(a.images).toEqual({ total: 3, missingAlt: 0, emptyAlt: 1, altEqualsFilename: 1 });
    expect(a.findings.map((f) => f.rule)).toEqual(["img-alt-filename"]);
  });
});