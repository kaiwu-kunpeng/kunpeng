import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  buildSiteReport, renderSiteReportMarkdown, reportFileStem, summarizeSiteReport, writeSiteReport,
  type SiteReport,
} from "../../src/seo/report.js";

const ORIGIN = "https://demo-travel.ai";
const CLAIM = "129 official ticket sites";
const FIXED_NOW = Date.UTC(2026, 8, 8, 7, 15, 0);
const BODY = Array.from({ length: 40 }, (_, i) => `Sentence ${i} explains how a foreign card links to Alipay at the airport.`).join(" ");
const page = (title: string, links: string[] = [], extra = "", body = BODY) =>
  `<html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="${"d".repeat(120)}"><meta property="og:image" content="/og.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">${extra}</head><body><h1>${title}</h1><p>${body}</p>${links.map((l) => `<a href="${l}">${l}</a>`).join("")}</body></html>`;

const SITE: Record<string, { status?: number; type?: string; body?: string; link?: string }> = {
  "/robots.txt": { body: `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n` },
  "/llms.txt": { body: `# DemoTravel\n- [Tickets](/tickets)\n- [Gone](/gone)\n` },
  "/": { body: page("DemoTravel home for foreign visitors", ["/tickets", "/clean", "/long", "/shell", "/bad", "/gone"], `<script type="application/ld+json">{"@type":"Organization","url":"${ORIGIN}/","logo":"/icon.png"}</script>`), link: `</route-index.json>; rel="alternate"` },
  "/tickets": { body: page("Ticket sites for foreign visitors", ["/"], `<meta property="og:description" content="Built from ${CLAIM}.">`) },
  "/clean": { body: page("Passport checks at ticket counters", ["/"], `<link rel="canonical" href="${ORIGIN}/gone">`) },
  "/long": { body: page("Metro &amp; taxi fares in Shanghai for foreign visitors in 2026 explained", ["/"]) },
  "/shell": { body: `<html><head><title>App</title></head><body><noscript>Please enable JavaScript</noscript><div id="__next"></div><script src="/app.js"></script></body></html>` },
  "/bad": { body: `<html><head><meta charset="gbk"></head><body><h1>x</h1><h1>y</h1><img src="/p.png"><p>${BODY} �</p><a href="/">home</a></body></html>`, type: "text/html; charset=UTF-8" },
  "/orphan": { body: page("Orphan page nobody links to") },
  "/sitemap.xml": { type: "application/xml", body: `<sitemapindex><sitemap><loc>${ORIGIN}/sitemap-pages.xml</loc></sitemap></sitemapindex>` },
  "/sitemap-pages.xml": { type: "application/xml", body: `<urlset>${["/", "/tickets", "/clean", "/long", "/shell", "/bad", "/orphan"].map((p) => `<url><loc>${ORIGIN}${p}</loc></url>`).join("")}</urlset>` },
  "/route-index.json": { type: "application/json", body: "{}" },
  "/icon.png": { status: 404 },
  "/gone": { status: 404 },
};

const seen: string[] = [];
const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  seen.push(`${new Headers(init?.headers).get("user-agent") ?? "-"} ${url.pathname}`);
  if (url.hostname !== "demo-travel.ai") return new Response("", { status: 404 });
  const entry = SITE[url.pathname];
  if (entry === undefined) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  const headers: Record<string, string> = { "content-type": entry.type ?? "text/html; charset=utf-8" };
  if (entry.link !== undefined) headers.link = entry.link;
  return new Response(entry.body ?? "", { status: entry.status ?? 200, headers });
}) as unknown as typeof fetch;

const layer = (report: SiteReport, id: string) => report.layers.find((l) => l.id === id)!;
let cached: Promise<SiteReport> | undefined;
const build = () => (cached ??= buildSiteReport({ origin: `${ORIGIN}/some/page?x=1`, fetchImpl, now: () => FIXED_NOW }));

describe("整站审计报告:一次爬取跑全部门 + 页面审计 + SERP(作者锁定)", () => {
  test("buildSiteReport:抓取计数、分层灯、各层关键结论", async () => {
    const report = await build();
    expect(report.origin).toBe(ORIGIN);
    expect(report.generatedAt).toBe("2026-09-08T07:15:00.000Z");
    expect(report.crawl).toEqual({ pageCount: 7, statusCounts: { "200": 6, "404": 1 }, blockedByRobots: [], seconds: 0 });
    expect(report.layers.map((l) => l.id)).toEqual(["robots", "discovery", "sitemap", "page-audit", "serp", "canonical", "first-html"]);
    expect(report.layers.map((l) => l.label)).toEqual(["robots 三态", "发现层存活", "sitemap 孤儿", "页面代码审计", "SERP 行预算", "canonical 目标", "首个 HTML"]);
    expect(layer(report, "robots")).toMatchObject({ ok: true, errors: 0 });
    expect(report.robots.status).toBe(200);
    expect(report.robots.reports).toHaveLength(21);
    expect(layer(report, "discovery")).toMatchObject({ ok: false, errors: 2 });
    expect(report.discovery.findings.map((f) => f.rule)).toEqual(["discovery-dead-url", "discovery-dead-url"]);
    expect(layer(report, "sitemap")).toMatchObject({ ok: false, errors: 1 });
    expect(report.sitemap.sitemapStatus).toBe("ok");
    expect(report.sitemap.sitemapCount).toBe(7);
    expect(report.sitemap.orphans).toEqual([`${ORIGIN}/orphan`]);
    expect(report.sitemap.notInSitemap).toEqual([]);
    expect(report.pageAudit.audited).toBe(6);
    expect(report.pageAudit.ruleCounts).toMatchObject({ mojibake: 1, "charset-mismatch": 1, "h1-multiple": 1, "title-missing": 1 });
    expect(layer(report, "page-audit").ok).toBe(false);
    expect(report.pageAudit.worst[0].url).toBe(`${ORIGIN}/bad`);
    expect(report.pageAudit.worst[0].rules).toContain("mojibake");
    expect(report.pageAudit.worst.every((w) => w.errors + w.warns > 0)).toBe(true);
    expect(report.serp.overBudget).toEqual([{ url: `${ORIGIN}/long`, length: 73, title: "Metro &amp; taxi fares in Shanghai for foreign visitors in 2026 explained" }]);
    expect(report.serp.ruleCounts["serp-title-over-budget"]).toBe(1);
    expect(report.serp.duplicateTitles).toEqual([]);
    expect(layer(report, "serp").ok).toBe(false);
    expect(layer(report, "canonical")).toMatchObject({ ok: false, errors: 1 });
    expect(report.canonical).toMatchObject({ checked: 1, fetched: 1, ruleCounts: { "canonical-target-unreachable": 1 } });
    expect(report.canonical.findings.map((f) => [f.rule, f.evidence])).toEqual([["canonical-target-unreachable", `${ORIGIN}/gone`]]);
    expect(report.firstHtml).toEqual({ checked: 6, shellPages: [`${ORIGIN}/shell`] });
    expect(layer(report, "first-html")).toMatchObject({ ok: false, errors: 1 });
    expect(report.retraction).toBeUndefined();
    expect(report.totals.ok).toBe(false);
    expect(report.totals.errors).toBe(report.layers.reduce((n, l) => n + l.errors, 0));
    expect(report.totals.warns).toBe(report.layers.reduce((n, l) => n + l.warns, 0));
    expect(seen.some((s) => s.startsWith("kunpeng-seo/0.1 /robots.txt"))).toBe(true);
  });

  test("buildSiteReport:带 terms 时多出撤稿层且命中", async () => {
    const report = await buildSiteReport({ origin: ORIGIN, fetchImpl, terms: [CLAIM], now: () => FIXED_NOW });
    expect(report.layers.at(-1)).toMatchObject({ id: "retraction", label: "撤稿扫描", ok: false, errors: 1 });
    expect(report.retraction!.hits.map((h) => [h.url, h.facet])).toEqual([[`${ORIGIN}/tickets`, "social-meta"]]);
    expect(report.retraction!.checked.pages).toBe(6);
  });

  test("renderSiteReportMarkdown:标题、分层表、建议一节提到孤儿", async () => {
    const md = renderSiteReportMarkdown(await build());
    expect(md.startsWith(`# SEO 审计报告：${ORIGIN}\n`)).toBe(true);
    expect(md).toContain("抓取 7 页");
    expect(md).toContain("❌ 未通过");
    expect(md).toContain("| sitemap 孤儿 |");
    expect(md).toContain(`${ORIGIN}/orphan`);
    expect(md).toContain(`${ORIGIN}/shell`);
    expect(md).toContain("Metro &amp; taxi fares");
    expect(md).toContain("GPTBot");
    expect(md).toContain("mojibake");
    expect(md).toContain("| canonical 目标 |");
    expect(md).toContain("canonical-target-unreachable");
    expect(md.slice(md.indexOf("\n## 建议\n"))).toContain("canonical 指向的 URL 打不开");
    expect(md).toMatch(/\n## 建议\n/);
    expect(md.slice(md.indexOf("\n## 建议\n"))).toContain("孤儿");
  });

  test("reportFileStem / writeSiteReport:两个文件落盘、JSON 可回读", async () => {
    expect(reportFileStem(ORIGIN, FIXED_NOW)).toBe("demo-travel-ai-20260908-071500");
    expect(reportFileStem("https://www.Demo_Travel.ai:8443", FIXED_NOW)).toBe("www-demo-travel-ai-20260908-071500");
    const dir = mkdtempSync(join(tmpdir(), "seo-report-"));
    const report = await build();
    const files = await writeSiteReport(report, join(dir, "nested", "out"));
    expect(basename(files.jsonPath)).toBe("demo-travel-ai-20260908-071500.json");
    expect(basename(files.markdownPath)).toBe("demo-travel-ai-20260908-071500.md");
    expect(JSON.parse(readFileSync(files.jsonPath, "utf8"))).toEqual(report);
    expect(readFileSync(files.markdownPath, "utf8")).toBe(renderSiteReportMarkdown(report));
  });

  test("summarizeSiteReport:只回摘要,远小于工具输出预算", async () => {
    const report = await build();
    const files = { jsonPath: "/x/r.json", markdownPath: "/x/r.md" };
    const summary = summarizeSiteReport(report, files);
    expect(Object.keys(summary).sort()).toEqual(["files", "generatedAt", "layers", "origin", "pageCount", "topIssues", "totals"]);
    expect(summary.pageCount).toBe(7);
    expect(summary.files).toEqual(files);
    const topIssues = summary.topIssues as Array<{ layer: string; rule: string; evidence?: string }>;
    expect(topIssues.length).toBeGreaterThan(0);
    expect(topIssues.length).toBeLessThanOrEqual(10);
    expect(topIssues.some((i) => i.layer === "sitemap" && i.rule === "sitemap-orphan")).toBe(true);
    expect(JSON.stringify(summary).length).toBeLessThan(6000);
    expect(summarizeSiteReport(report).files).toBeUndefined();
  });
});