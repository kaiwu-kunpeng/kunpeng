import { describe, expect, test } from "vitest";
import { crawlSite } from "../../src/seo/crawl.js";
import {
  effectiveGroup, isAllowedByRobots, parseRobotsGroups, robotsPatternMatches, verdictFor,
} from "../../src/seo/gates/robots-classes.js";

describe("robotsPatternMatches（作者锁定，用例取自 RFC 9309 与 Google 文档）", () => {
  test("前缀、通配、行尾锚定、字面字符", () => {
    expect(robotsPatternMatches("/fish", "/fish.html")).toBe(true);
    expect(robotsPatternMatches("/fish", "/Fish.asp")).toBe(false);
    expect(robotsPatternMatches("/fish*", "/fishheads/yummy.html")).toBe(true);
    expect(robotsPatternMatches("/*.php", "/folder/filename.php?parameters")).toBe(true);
    expect(robotsPatternMatches("/*.php", "/windows.PHP")).toBe(false);
    expect(robotsPatternMatches("/*.php$", "/filename.php")).toBe(true);
    expect(robotsPatternMatches("/*.php$", "/filename.php?parameters")).toBe(false);
    expect(robotsPatternMatches("/*.php$", "/filename.php5")).toBe(false);
    expect(robotsPatternMatches("/fish*.php", "/fishheads/catfish.php?p=1")).toBe(true);
    expect(robotsPatternMatches("/fish*.php", "/Fish.PHP")).toBe(false);
    expect(robotsPatternMatches("/*?sort=", "/list?sort=price")).toBe(true);
    expect(robotsPatternMatches("/*?sort=", "/list")).toBe(false);
    expect(robotsPatternMatches("/a.b", "/axb")).toBe(false);
    expect(robotsPatternMatches("/", "/anything")).toBe(true);
    expect(robotsPatternMatches("/$", "/")).toBe(true);
    expect(robotsPatternMatches("/$", "/page")).toBe(false);
  });

  test("isAllowedByRobots：最长规则胜、等长 Allow 胜、通配规则参与比较", () => {
    const p = parseRobotsGroups([
      "User-agent: *",
      "Disallow: /api/",
      "Allow: /api/public",
      "Disallow: /*?sort=",
      "Disallow: /*.pdf$",
      "Allow: /$",
      "Disallow: /",
      "Allow: /page",
      "",
      "User-agent: GPTBot",
      "Disallow: /",
    ].join("\n"));
    expect(isAllowedByRobots(p, "kunpeng-seo/0.1", "/")).toBe(true);
    expect(isAllowedByRobots(p, "kunpeng-seo/0.1", "/page")).toBe(true);
    expect(isAllowedByRobots(p, "kunpeng-seo/0.1", "/page/list?sort=a")).toBe(false);
    expect(isAllowedByRobots(p, "kunpeng-seo/0.1", "/api/x")).toBe(false);
    expect(isAllowedByRobots(p, "kunpeng-seo/0.1", "/api/public/y")).toBe(true);
    expect(isAllowedByRobots(p, "kunpeng-seo/0.1", "/pagedoc.pdf")).toBe(false);
    expect(isAllowedByRobots(p, "kunpeng-seo/0.1", "/pagedoc.pdf?v=2")).toBe(true);
    expect(isAllowedByRobots(p, "kunpeng-seo/0.1", "/other")).toBe(false);
    expect(isAllowedByRobots(p, "Mozilla/5.0 (compatible; GPTBot/1.2)", "/page")).toBe(false);
    expect(isAllowedByRobots(parseRobotsGroups(""), "x", "/any")).toBe(true);
    expect(isAllowedByRobots(parseRobotsGroups("User-agent: GPTBot\nDisallow: /\n"), "Bingbot", "/any")).toBe(true);
  });

  test("verdictFor：只有通配 disallow 的组判 partial", () => {
    const p = parseRobotsGroups("User-agent: *\nDisallow: /*.pdf$\nDisallow: /*?session=\n");
    expect(verdictFor(effectiveGroup(p, "PerplexityBot"))).toBe("partial");
    expect(verdictFor(effectiveGroup(p, "PerplexityBot"), "/doc.pdf")).toBe("blocked");
    const scoped = parseRobotsGroups("User-agent: *\nDisallow: /docs/*.pdf$\n");
    expect(verdictFor(scoped.groups[0], "/")).toBe("partial");
    expect(verdictFor(scoped.groups[0], "/docs")).toBe("partial");
    expect(verdictFor(scoped.groups[0], "/docs/manuals")).toBe("partial");
    expect(verdictFor(scoped.groups[0], "/other")).toBe("allowed");
  });
});

describe("crawlSite 走同一套 robots 判定（作者锁定）", () => {
  const ORIGIN = "https://robots-demo.test";
  const page = (links: string[]) => `<html><head><title>t</title></head><body>${links.map((l) => `<a href="${l}">x</a>`).join("")}</body></html>`;
  const SITE: Record<string, string> = {
    "/robots.txt": "User-agent: *\nDisallow: /api/\nAllow: /api/public\nDisallow: /*?sort=\nDisallow: /*.pdf$\n",
    "/": page(["/list", "/list?sort=price", "/api/secret", "/api/public/doc", "/file.pdf", "/file.pdf?dl=1"]),
    "/list": page([]),
    "/api/public/doc": page([]),
    "/file.pdf?dl=1": page([]),
  };
  const fetchImpl = (async (input: string | URL | Request) => {
    const u = new URL(String(input));
    const body = SITE[u.pathname + u.search];
    return new Response(body ?? "nope", { status: body ? 200 : 404, headers: { "content-type": "text/html" } });
  }) as typeof fetch;

  test("Allow 覆盖更短的 Disallow；通配与 $ 生效；判定包含查询串", async () => {
    const r = await crawlSite({ startUrl: ORIGIN, fetchImpl });
    const crawled = r.pages.map((p) => p.url).sort();
    expect(crawled).toEqual([`${ORIGIN}/`, `${ORIGIN}/api/public/doc`, `${ORIGIN}/file.pdf?dl=1`, `${ORIGIN}/list`].sort());
    expect([...r.blockedByRobots].sort()).toEqual([`${ORIGIN}/api/secret`, `${ORIGIN}/file.pdf`, `${ORIGIN}/list?sort=price`].sort());
  });
});