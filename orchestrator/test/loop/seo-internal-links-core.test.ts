import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  DEFAULT_LEVERS,
  SEO_INTERNAL_LINKS_RECIPE_ID,
  selectIndexNowCandidates,
  snapshotPath,
  type InternalLinksSnapshot,
} from "../../src/loop/recipes/seo-internal-links/core.js";
import { ACTION_LEVELS, parseLeverSpec } from "../../src/loop/types.js";

function snap(over: Partial<InternalLinksSnapshot> = {}): InternalLinksSnapshot {
  return {
    at: 1, startUrl: "https://shop.example/", maxPages: 200, pageCount: 4,
    okUrls: ["https://shop.example/", "https://shop.example/a", "https://shop.example/b", "https://shop.example/c"],
    broken: [], notInSitemap: [], orphans: [], blockedByRobots: [], sitemapStatus: "ok", linkDefects: 0,
    ...over,
  };
}

describe("seo-internal-links 纯函数（作者锁定）", () => {
  it("等级表与默认抓手：crawl=L0、submit-indexnow=L3", () => {
    expect(ACTION_LEVELS).toEqual(["L0", "L1", "L2", "L3", "L4"]);
    expect(SEO_INTERNAL_LINKS_RECIPE_ID).toBe("seo-internal-links");
    expect(DEFAULT_LEVERS.map((l) => [l.id, l.level])).toEqual([["crawl", "L0"], ["submit-indexnow", "L3"]]);
    expect(snapshotPath("/s", "pz-links")).toBe(join("/s", "ops", "seo-internal-links", "pz-links.json"));
  });

  it("parseLeverSpec：id=label=level；坏格式或坏等级抛错", () => {
    expect(parseLeverSpec("crawl=只读抓取=L0")).toEqual({ id: "crawl", label: "只读抓取", status: "active", level: "L0" });
    expect(() => parseLeverSpec("crawl=只读抓取")).toThrow(/crawl=只读抓取/);
    expect(() => parseLeverSpec("x=y=L9")).toThrow(/L9/);
  });

  it("确定性前置：跨域/robots/非 200 html/超帽各有原因，通过的按字典序", () => {
    const s = snap({
      notInSitemap: [
        "https://shop.example/c", "https://shop.example/b", "https://other.example/z",
        "https://shop.example/blocked", "https://shop.example/dead", "https://shop.example/b",
      ],
      blockedByRobots: ["https://shop.example/blocked"],
    });
    const r = selectIndexNowCandidates(s);
    expect(r.urls).toEqual(["https://shop.example/b", "https://shop.example/c"]);
    expect(r.rejected).toEqual(expect.arrayContaining([
      { url: "https://other.example/z", reason: "cross-origin" },
      { url: "https://shop.example/blocked", reason: "robots" },
      { url: "https://shop.example/dead", reason: "not-200-html" },
    ]));
    expect(r.rejected).toHaveLength(3);
    const capped = selectIndexNowCandidates(s, { max: 1 });
    expect(capped.urls).toEqual(["https://shop.example/b"]);
    expect(capped.rejected.some((x) => x.url === "https://shop.example/c" && x.reason === "over-cap")).toBe(true);
  });

  it("空候选池 → 空结果", () => {
    expect(selectIndexNowCandidates(snap())).toEqual({ urls: [], rejected: [] });
  });
});