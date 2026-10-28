import { describe, expect, test } from "vitest";
import { crawlSite } from "../../src/seo/crawl.js";
import { buildSiteReport } from "../../src/seo/report.js";

const O = "https://redir.test";
const page = (lang: string, title: string, body: string, links: string[]) =>
  `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>${body}</p>${links.map((l) => `<a href="${l}">${l}</a>`).join("")}</body></html>`;
const WORDS = "Solar modules for homes and businesses with long warranty and local service across Europe. ".repeat(20);

const SITE: Record<string, { body?: string; redirectTo?: string; status?: number }> = {
  "/robots.txt": { body: "User-agent: *\nDisallow: /private\n" },
  "/": { body: page("en", "Home", WORDS, ["/de/x", "/a", "/b", "/c", "/d", "/e", "/private/p"]) },
  "/de/x": { redirectTo: "/cn/x" },
  "/cn/x": { body: page("zh-CN", "中文页", "很短。", ["rel-from-final"]) },
  "/cn/rel-from-final": { body: page("zh-CN", "相对链接", WORDS, []) },
  "/a": { body: page("en", "A", WORDS, ["/f"]) },
  "/b": { body: page("en", "B", WORDS, []) },
  "/c": { body: page("en", "C", WORDS, []) },
  "/d": { body: page("en", "D", WORDS, []) },
  "/e": { body: page("en", "E", WORDS, []) },
  "/f": { body: page("en", "F", WORDS, []) },
  "/sitemap.xml": { body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${O}/</loc></url></urlset>` },
};

function makeFetch() {
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchImpl = (async (input: string | URL | Request) => {
    const u = new URL(String(input));
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    let path = u.pathname;
    let entry = SITE[path];
    if (entry?.redirectTo) {
      path = entry.redirectTo;
      entry = SITE[path];
    }
    const res = new Response(entry?.body ?? "nf", {
      status: entry ? (entry.status ?? 200) : 404,
      headers: { "content-type": path.endsWith(".xml") || path.endsWith(".txt") ? "text/plain" : "text/html" },
    });
    Object.defineProperty(res, "url", { value: `${u.origin}${path}` });
    return res;
  }) as unknown as typeof fetch;
  return { fetchImpl, max: () => maxInFlight };
}

describe("crawlSite 最终 URL（作者锁定）", () => {
  test("跳转页记 finalUrl，出链相对落地页解析，落地页自己入队", async () => {
    const { fetchImpl } = makeFetch();
    const r = await crawlSite({ startUrl: O, fetchImpl });
    const by = new Map(r.pages.map((p) => [p.url, p]));
    expect(by.get(`${O}/de/x`)?.finalUrl).toBe(`${O}/cn/x`);
    expect(by.get(`${O}/de/x`)?.links).toEqual([`${O}/cn/rel-from-final`]);
    expect(by.has(`${O}/cn/x`)).toBe(true);
    expect(by.get(`${O}/cn/x`)?.finalUrl).toBeUndefined();
    expect("finalUrl" in by.get(`${O}/a`)!).toBe(false);
    expect(by.has(`${O}/cn/rel-from-final`)).toBe(true);
    expect(r.blockedByRobots).toEqual([`${O}/private/p`]);
  });
});

describe("crawlSite 确定性分批并发（作者锁定）", () => {
  test("并发下结果与串行逐字相同，且真的并发了", async () => {
    const serial = makeFetch();
    const a = await crawlSite({ startUrl: O, fetchImpl: serial.fetchImpl });
    expect(serial.max()).toBe(1);
    const par = makeFetch();
    const b = await crawlSite({ startUrl: O, fetchImpl: par.fetchImpl, concurrency: 4 });
    expect(par.max()).toBeGreaterThanOrEqual(3);
    expect(par.max()).toBeLessThanOrEqual(4);
    expect(b.pages).toEqual(a.pages);
    expect(b.edges).toEqual(a.edges);
    expect(b.blockedByRobots).toEqual(a.blockedByRobots);
  });

  test("maxPages 在并发下仍是硬上限，且与串行取到同一批页", async () => {
    const s = await crawlSite({ startUrl: O, fetchImpl: makeFetch().fetchImpl, maxPages: 4 });
    const p = await crawlSite({ startUrl: O, fetchImpl: makeFetch().fetchImpl, maxPages: 4, concurrency: 16 });
    expect(p.pages).toHaveLength(4);
    expect(p.pages.map((x) => x.url)).toEqual(s.pages.map((x) => x.url));
  });

  test("concurrency 夹紧：0 当 1、100 当 16", async () => {
    const one = makeFetch();
    await crawlSite({ startUrl: O, fetchImpl: one.fetchImpl, concurrency: 0 });
    expect(one.max()).toBe(1);
    const big = makeFetch();
    await crawlSite({ startUrl: O, fetchImpl: big.fetchImpl, concurrency: 100 });
    expect(big.max()).toBeLessThanOrEqual(16);
  });
});

describe("站点报告：跳转页不进内容层（作者锁定）", () => {
  test("redirects 列出跳转；跳转页不出现在逐页审计里；crawl 结构不变", async () => {
    const report = await buildSiteReport({ origin: O, fetchImpl: makeFetch().fetchImpl, now: () => 0 });
    expect(report.redirects).toEqual([{ from: `${O}/de/x`, to: `${O}/cn/x` }]);
    expect(Object.keys(report.crawl).sort()).toEqual(["blockedByRobots", "pageCount", "seconds", "statusCounts"]);
    expect(report.firstHtml.shellPages).toContain(`${O}/cn/x`);
    expect(report.firstHtml.shellPages).not.toContain(`${O}/de/x`);
    expect(JSON.stringify(report.pageAudit)).not.toContain(`${O}/de/x`);
    expect(report.firstHtml.checked).toBe(report.crawl.pageCount - 1);
  });
});