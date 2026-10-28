import { describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CrawlPage } from "../../src/seo/crawl.js";
import { htmlFileToPath, linkGraphFromHtmlDir, runSitemapOrphanGate } from "../../src/seo/gates/sitemap-orphan.js";

const ORIGIN = "https://demo-travel.ai";
const U = (path: string) => `${ORIGIN}${path}`;
const page = (url: string, depth: number, links: string[] = []): CrawlPage =>
  ({ url, status: 200, depth, contentType: "text/html", title: url, links });
const edgesOf = (pages: CrawlPage[]): Array<[string, string]> => pages.flatMap((p) => p.links.map((l) => [p.url, l] as [string, string]));

const healthyPages = [
  page(U("/"), 0, [U("/a"), U("/b"), U("/search?q=x")]),
  page(U("/a"), 1, [U("/b"), U("/c")]),
  page(U("/b"), 1, [U("/a")]),
  page(U("/c"), 2, []),
  page(U("/search?q=x"), 1, []),
];
const healthySitemap = [U("/"), U("/a"), U("/b"), U("/c")];

describe("D6 sitemap 孤儿门(作者锁定)", () => {
  test("健康图:ok、无 error、linkedCount 全覆盖", () => {
    const r = runSitemapOrphanGate({ pages: healthyPages, edges: edgesOf(healthyPages), sitemapUrls: healthySitemap });
    expect(r.ok).toBe(true);
    expect(r.orphans).toEqual([]);
    expect(r.ignored).toEqual([]);
    expect(r.sitemapCount).toBe(4);
    expect(r.linkedCount).toBe(4);
    expect(r.findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(r.notInSitemap).toEqual([U("/search?q=x")]);
    expect(r.findings.map((f) => f.rule)).toEqual(["not-in-sitemap"]);
  });

  test("变异:删掉指向 /c 的唯一入链 → 孤儿 → 红,每个孤儿一条 error", () => {
    const mutated = healthyPages.map((p) => (p.url === U("/a") ? { ...p, links: [U("/b")] } : p));
    const r = runSitemapOrphanGate({ pages: mutated, edges: edgesOf(mutated), sitemapUrls: [...healthySitemap, U("/ghost")] });
    expect(r.ok).toBe(false);
    expect(r.orphans).toEqual([U("/c"), U("/ghost")]);
    expect(r.linkedCount).toBe(3);
    const errors = r.findings.filter((f) => f.severity === "error");
    expect(errors.map((f) => f.rule)).toEqual(["sitemap-orphan", "sitemap-orphan"]);
    expect(errors.map((f) => f.evidence)).toEqual([U("/c"), U("/ghost")]);
    expect(errors[0].message).toContain(U("/c"));
  });

  test("allow 前缀:被豁免的孤儿进 ignored,不算红;空 sitemap 直接红", () => {
    const mutated = healthyPages.map((p) => (p.url === U("/a") ? { ...p, links: [U("/b")] } : p));
    const r = runSitemapOrphanGate({ pages: mutated, edges: edgesOf(mutated), sitemapUrls: [...healthySitemap, U("/auth/login")], allow: ["/c", "/auth/"] });
    expect(r.ok).toBe(true);
    expect(r.orphans).toEqual([]);
    expect(r.ignored).toEqual([U("/auth/login"), U("/c")]);
    const empty = runSitemapOrphanGate({ pages: healthyPages, edges: edgesOf(healthyPages), sitemapUrls: [] });
    expect(empty.ok).toBe(false);
    expect(empty.findings[0]).toMatchObject({ rule: "sitemap-empty", severity: "error" });
  });

  test("深页警告:depth > maxDepthOk 只警告不红", () => {
    const chain = [
      page(U("/"), 0, [U("/d1")]), page(U("/d1"), 1, [U("/d2")]), page(U("/d2"), 2, [U("/d3")]),
      page(U("/d3"), 3, [U("/d4")]), page(U("/d4"), 4, [U("/d5")]), page(U("/d5"), 5, []),
    ];
    const sitemap = chain.map((p) => p.url);
    const r = runSitemapOrphanGate({ pages: chain, edges: edgesOf(chain), sitemapUrls: sitemap });
    expect(r.ok).toBe(true);
    expect(r.deep).toEqual([U("/d4"), U("/d5")]);
    const deep = r.findings.find((f) => f.rule === "deep-page")!;
    expect(deep.severity).toBe("warn");
    expect(deep.message).toContain("2");
    expect(deep.message).toContain("3");
    expect(runSitemapOrphanGate({ pages: chain, edges: edgesOf(chain), sitemapUrls: sitemap, maxDepthOk: 5 }).deep).toEqual([]);
  });

  test("htmlFileToPath:路由组、index、下划线与动态段", () => {
    expect(htmlFileToPath("index.html")).toBe("/");
    expect(htmlFileToPath("(en)/cities.html")).toBe("/cities");
    expect(htmlFileToPath("es/index.html")).toBe("/es");
    expect(htmlFileToPath("(en)/cities/beijing.html")).toBe("/cities/beijing");
    expect(htmlFileToPath("(marketing)/(home)/index.html")).toBe("/");
    expect(htmlFileToPath("_not-found.html")).toBeNull();
    expect(htmlFileToPath("(en)/_global-error.html")).toBeNull();
    expect(htmlFileToPath("[locale]/[slug].html")).toBeNull();
    expect(htmlFileToPath("cities.rsc")).toBeNull();
    expect(htmlFileToPath("page.meta")).toBeNull();
  });

  test("离线建图:预渲染目录 → 页面、出链、BFS 深度,再喂给门抓出孤儿", () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-prerender-"));
    const html = (title: string, links: string[]) =>
      `<html><head><title>${title}</title></head><body>${links.map((l) => `<a href="${l}">${l}</a>`).join("")}</body></html>`;
    mkdirSync(join(dir, "(en)", "cities"), { recursive: true });
    mkdirSync(join(dir, "es"), { recursive: true });
    mkdirSync(join(dir, "[locale]"), { recursive: true });
    writeFileSync(join(dir, "index.html"), html("Home", ["/cities", "/es", "/cities/beijing#top", "https://other.example/x"]));
    writeFileSync(join(dir, "(en)", "cities.html"), html("Cities", ["/cities/beijing", "/"]));
    writeFileSync(join(dir, "(en)", "cities", "beijing.html"), html("Beijing", ["/cities"]));
    writeFileSync(join(dir, "es", "index.html"), html("ES", ["/es/cities"]));
    writeFileSync(join(dir, "es", "cities.html"), html("ES Cities", []));
    writeFileSync(join(dir, "es", "beijing.html"), html("ES Beijing", ["/es/cities"]));
    writeFileSync(join(dir, "_not-found.html"), html("404", ["/"]));
    writeFileSync(join(dir, "[locale]", "[slug].html"), html("tpl", ["/"]));
    writeFileSync(join(dir, "cities.rsc"), "rsc payload");

    const g = linkGraphFromHtmlDir(dir, ORIGIN);
    expect(g.pages.map((p) => p.url)).toEqual([U("/"), U("/cities"), U("/cities/beijing"), U("/es"), U("/es/beijing"), U("/es/cities")]);
    const byUrl = new Map(g.pages.map((p) => [p.url, p]));
    expect(byUrl.get(U("/"))).toMatchObject({ depth: 0, title: "Home", status: 200, contentType: "text/html", links: [U("/cities"), U("/es"), U("/cities/beijing")] });
    expect(byUrl.get(U("/cities/beijing"))?.depth).toBe(1);
    expect(byUrl.get(U("/es/cities"))?.depth).toBe(2);
    expect(byUrl.get(U("/es/beijing"))?.depth).toBe(-1);
    expect(g.edges).toContainEqual([U("/es/beijing"), U("/es/cities")]);
    expect(g.edges.some(([, to]) => to.startsWith("https://other.example"))).toBe(false);

    const r = runSitemapOrphanGate({ ...g, sitemapUrls: [U("/"), U("/cities"), U("/cities/beijing"), U("/es"), U("/es/cities"), U("/es/beijing")] });
    expect(r.ok).toBe(false);
    expect(r.orphans).toEqual([U("/es/beijing")]);
    expect(r.linkedCount).toBe(5);
  });
});