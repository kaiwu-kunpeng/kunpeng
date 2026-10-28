import { describe, expect, test, vi } from "vitest";
import { checkFirstHtml, runFirstHtmlGate, visibleText, type FirstHtmlExpectation } from "../../src/seo/gates/first-html.js";

const URL_OK = "https://demo-travel.ai/guides/alipay-setup";
const BODY = Array.from({ length: 40 }, (_, i) => `Sentence ${i} explains how a foreign card links to Alipay at the airport.`).join(" ");
const SSR = `<!doctype html><html lang="en"><head><title>Alipay setup guide</title>
<script type="application/ld+json">{"@type":"Article","author":{"name":"Editorial Desk"}}</script>
<style>.x{color:red}</style></head>
<body><div id="__next"><article>
<h1>Set up Alipay in China</h1>
<p class="byline">By <span class="author">Editorial   Desk</span> · Updated <time datetime="2026-09-01">1 September 2026</time></p>
<p class="price">From <strong>¥ 0</strong> to open, card fee 3%</p>
<p>${BODY}</p>
<script>console.log("hydrate words should not count at all")</script>
</article></div></body></html>`;

const SHELL = `<!doctype html><html><head><title>App</title></head>
<body><noscript>You need to enable JavaScript to run this app.</noscript><div id="__next"></div>
<script src="/static/app.js"></script></body></html>`;

const EXPECT: FirstHtmlExpectation[] = [
  { id: "h1", text: "Set up Alipay in China", selector: "h1" },
  { id: "author", text: "editorial desk", selector: ".byline" },
  { id: "date", regex: "\\b(1|01) September 2026\\b" },
  { id: "price", text: "card fee 3%" },
];

describe("D8 首个 HTML 门(作者锁定)", () => {
  test("visibleText 去掉 script/style/noscript,折叠空白,支持选择器", () => {
    expect(visibleText(SSR, ".author")).toBe("Editorial Desk");
    const all = visibleText(SSR);
    expect(all).not.toContain("hydrate words");
    expect(all).not.toContain("color:red");
    expect(all).not.toContain('"@type"');
    expect(all).toContain("Set up Alipay in China By Editorial Desk");
    expect(visibleText(SHELL)).toBe("");
  });

  test("SSR 页面:全部期望命中,不是空壳,ok", () => {
    const r = checkFirstHtml({ url: URL_OK, html: SSR, expectations: EXPECT });
    expect(r.ok).toBe(true);
    expect(r.shell).toBe(false);
    expect(r.wordCount).toBeGreaterThan(150);
    expect(r.present).toEqual(["h1", "author", "date", "price"]);
    expect(r.missing).toEqual([]);
    expect(r.findings).toEqual([]);
  });

  test("变异:JS 空壳 → shell + noscript + empty-root + 每个期望一条 missing,红", () => {
    const r = checkFirstHtml({ url: URL_OK, html: SHELL, expectations: EXPECT });
    expect(r.ok).toBe(false);
    expect(r.shell).toBe(true);
    expect(r.wordCount).toBe(0);
    expect(r.present).toEqual([]);
    expect(r.missing).toEqual(["h1", "author", "date", "price"]);
    expect(r.findings.map((f) => f.rule)).toEqual([
      "first-html-shell", "first-html-noscript", "first-html-empty-root",
      "first-html-missing", "first-html-missing", "first-html-missing", "first-html-missing",
    ]);
    expect(r.findings[0]).toMatchObject({ severity: "error" });
    expect(r.findings[0].message).toContain("150");
    expect(r.findings[1].severity).toBe("warn");
    expect(r.findings[2]).toMatchObject({ severity: "warn", evidence: "#__next" });
    expect(r.findings[3]).toMatchObject({ severity: "error", evidence: "Set up Alipay in China" });
    expect(r.findings[3].message).toContain("h1");
    expect(r.findings[5].evidence).toBe("\\b(1|01) September 2026\\b");
  });

  test("变异:内容完整但少一条期望 → 只那一条 missing 红;minWords 可调", () => {
    const r = checkFirstHtml({ url: URL_OK, html: SSR, expectations: [...EXPECT, { id: "stock", text: "in stock", selector: ".price" }] });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["stock"]);
    expect(r.findings.map((f) => f.rule)).toEqual(["first-html-missing"]);
    const strict = checkFirstHtml({ url: URL_OK, html: SSR, expectations: EXPECT, minWords: 100_000 });
    expect(strict.shell).toBe(true);
    expect(strict.ok).toBe(false);
    expect(strict.findings.map((f) => f.rule)).toEqual(["first-html-shell"]);
    const lax = checkFirstHtml({ url: URL_OK, html: SHELL, expectations: [], minWords: 0 });
    expect(lax.ok).toBe(true);
    expect(lax.findings.map((f) => f.rule)).toEqual(["first-html-noscript", "first-html-empty-root"]);
  });

  test("text 与 regex 同给时都要成立;选择器没命中元素算缺失", () => {
    const both = checkFirstHtml({ url: URL_OK, html: SSR, expectations: [{ id: "d", text: "September", regex: "^\\d{4}$" }], minWords: 0 });
    expect(both.missing).toEqual(["d"]);
    const noEl = checkFirstHtml({ url: URL_OK, html: SSR, expectations: [{ id: "x", text: "Alipay", selector: ".does-not-exist" }], minWords: 0 });
    expect(noEl.missing).toEqual(["x"]);
  });

  test("runFirstHtmlGate:经 fetchImpl 抓取,带 UA 与 accept;非 200 与抛错都红", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/boom")) throw new Error("socket hang up");
      if (url.endsWith("/gone")) return new Response("nope", { status: 404 });
      return new Response(SSR, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    });
    const ok = await runFirstHtmlGate({ url: URL_OK, expectations: EXPECT, fetchImpl: fetchImpl as unknown as typeof fetch, userAgent: "DemoBot/1" });
    expect(ok.ok).toBe(true);
    expect(ok.status).toBe(200);
    const headers = new Headers(fetchImpl.mock.calls[0][1]?.headers);
    expect(headers.get("user-agent")).toBe("DemoBot/1");
    expect(headers.get("accept")).toBe("text/html");

    const gone = await runFirstHtmlGate({ url: "https://demo-travel.ai/gone", expectations: EXPECT, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(gone.ok).toBe(false);
    expect(gone.status).toBe(404);
    expect(gone.missing).toEqual(["h1", "author", "date", "price"]);
    expect(gone.findings).toEqual([{ rule: "first-html-status", severity: "error", message: expect.any(String), evidence: "404" }]);

    const boom = await runFirstHtmlGate({ url: "https://demo-travel.ai/boom", expectations: EXPECT, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(boom.ok).toBe(false);
    expect(boom.status).toBe(0);
    expect(boom.findings[0]).toMatchObject({ rule: "first-html-status", evidence: "socket hang up" });
  });
});