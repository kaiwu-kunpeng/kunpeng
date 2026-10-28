import { join } from "node:path";
import type { Lever } from "../../types.js";

export const SEO_INTERNAL_LINKS_RECIPE_ID = "seo-internal-links";
export const SEO_LOOP_USER_AGENT = "kunpeng-seo/0.1";

export const DEFAULT_LEVERS: Lever[] = [
  { id: "crawl", label: "只读抓取内链现状", status: "active", level: "L0" },
  { id: "submit-indexnow", label: "缺陷页提交收录（入 outbox 等人放行）", status: "active", level: "L3" },
];

export interface InternalLinksSnapshot {
  at: number;
  startUrl: string;
  maxPages: number;
  pageCount: number;
  okUrls: string[];
  broken: Array<{ from: string; to: string; status: number }>;
  notInSitemap: string[];
  orphans: string[];
  blockedByRobots: string[];
  sitemapStatus: "ok" | "missing";
  linkDefects: number;
}

export function snapshotPath(stateDir: string, loopId: string): string {
  return join(stateDir, "ops", "seo-internal-links", `${loopId}.json`);
}

export function selectIndexNowCandidates(
  snapshot: InternalLinksSnapshot,
  opts?: { max?: number },
): { urls: string[]; rejected: Array<{ url: string; reason: "cross-origin" | "robots" | "not-200-html" | "over-cap" }> } {
  const urls: string[] = [];
  const rejected: Array<{ url: string; reason: "cross-origin" | "robots" | "not-200-html" | "over-cap" }> = [];
  for (const url of [...new Set(snapshot.notInSitemap)].sort()) {
    if (new URL(url).origin !== new URL(snapshot.startUrl).origin) {
      rejected.push({ url, reason: "cross-origin" });
    } else if (snapshot.blockedByRobots.includes(url)) {
      rejected.push({ url, reason: "robots" });
    } else if (!snapshot.okUrls.includes(url)) {
      rejected.push({ url, reason: "not-200-html" });
    } else if (urls.length >= (opts?.max ?? 50)) {
      rejected.push({ url, reason: "over-cap" });
    } else {
      urls.push(url);
    }
  }
  return { urls, rejected };
}
