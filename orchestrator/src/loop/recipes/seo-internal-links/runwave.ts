import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { crawlSite } from "../../../seo/crawl.js";
import { buildLinkGraph } from "../../../seo/link-graph.js";
import { loadSitemapUrls } from "../../../seo/report.js";
import { enqueueOutbox } from "../../outbox.js";
import type { WaveResult } from "../../recipe.js";
import type { LoopDef } from "../../types.js";
import { SEO_LOOP_USER_AGENT, selectIndexNowCandidates, snapshotPath, type InternalLinksSnapshot } from "./core.js";

export interface SeoInternalLinksDeps {
  repoRoot?: string;
  stateDir?: string;
  fetchImpl?: typeof fetch;
  enqueue?: (repoRoot: string, channel: string, payload: { urls: string[]; host: string }) => { id: string };
  now?: () => number;
  maxPages?: number;
}

const execFileAsync = promisify(execFile);

export function curlFetchImpl(userAgent: string): typeof fetch {
  return async (input) => {
    try {
      const dir = await mkdtemp(join(tmpdir(), "kunpeng-seo-"));
      try {
        const bodyPath = join(dir, "body");
        const url = input instanceof Request ? input.url : String(input);
        const { stdout } = await execFileAsync("curl", [
          "-4", "-sSL", "--compressed", "-m", "20", "-A", userAgent,
          "-o", bodyPath, "-w", "%{http_code}\t%{content_type}\t%{url_effective}", url,
        ], { maxBuffer: 16 * 1024 * 1024, timeout: 25_000, killSignal: "SIGKILL" });
        const [httpCode, contentType, urlEffective] = stdout.split("\t");
        const status = Number(httpCode);
        if (!Number.isInteger(status) || status < 200 || status > 599) return Response.error();
        const body = new Uint8Array(await readFile(bodyPath));
        const response = new Response([204, 205, 304].includes(status) ? null : body, {
          status, headers: { "content-type": contentType },
        });
        Object.defineProperty(response, "url", { value: urlEffective });
        return response;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    } catch {
      // Response's constructor rejects status 0; error() creates the status-0 response.
      return Response.error();
    }
  };
}

export async function runSeoInternalLinksWave(
  loop: LoopDef,
  lever: string,
  target: string | undefined,
  deps?: unknown,
): Promise<WaveResult> {
  const d = (deps ?? {}) as SeoInternalLinksDeps;
  const repoRoot = d.repoRoot ?? process.cwd();
  const stateDir = d.stateDir ?? join(repoRoot, ".kunpeng");
  const fetchImpl = d.fetchImpl ?? curlFetchImpl(SEO_LOOP_USER_AGENT);
  const maxPages = d.maxPages ?? 200;
  const now = d.now ?? Date.now;
  const path = resolve(snapshotPath(stateDir, loop.id));
  let prev: InternalLinksSnapshot | undefined;
  try {
    prev = JSON.parse(await readFile(path, "utf8")) as InternalLinksSnapshot;
  } catch {
    // An unreadable snapshot is treated as no previous measurement.
  }

  if (lever === "crawl") {
    const startUrl = target ?? prev?.startUrl;
    if (!startUrl) throw new Error("crawl 需要 target=<站点 URL>");
    const { pages, edges, blockedByRobots } = await crawlSite({
      startUrl, fetchImpl, maxPages, userAgent: SEO_LOOP_USER_AGENT, respectRobots: true,
    });
    const sitemapUrls = await loadSitemapUrls(new URL(startUrl).origin + "/sitemap.xml", {
      fetchImpl, userAgent: SEO_LOOP_USER_AGENT,
    });
    const { broken, notInSitemap, orphans } = buildLinkGraph({ pages, edges, sitemapUrls, startUrl });
    const linkDefects = broken.length + notInSitemap.length;
    const snapshot: InternalLinksSnapshot = {
      at: now(), startUrl, maxPages, pageCount: pages.length,
      okUrls: pages.filter((page) => page.status === 200 && page.contentType.includes("text/html"))
        .map((page) => page.url).sort(),
      broken, notInSitemap, orphans, blockedByRobots,
      sitemapStatus: sitemapUrls === undefined ? "missing" : "ok",
      linkDefects,
    };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    const metricBefore = prev?.linkDefects ?? loop.metric.current;
    const verified = snapshot.pageCount >= 2;
    return {
      metricBefore, metricAfter: linkDefects, metricDelta: linkDefects - metricBefore,
      level: "L0", evidence: path, verified,
      ...(verified ? { goalMetricCurrent: linkDefects } : { instrumentBroken: true }),
      detail: `抓取 ${snapshot.pageCount} 页，断链 ${broken.length}，漏 sitemap ${notInSitemap.length}，孤儿 ${orphans.length}，窗口 maxPages=${maxPages}`,
    };
  }

  if (lever === "submit-indexnow") {
    if (!prev) throw new Error("先跑 crawl 生成内链快照");
    const { urls, rejected } = selectIndexNowCandidates(prev, { max: 50 });
    const metrics = { metricBefore: prev.linkDefects, metricAfter: prev.linkDefects, metricDelta: 0 };
    if (urls.length === 0) {
      return {
        ...metrics, verified: false, level: "L3",
        detail: `无可提交候选（前置全拒），剔除 ${rejected.length} 条`,
      };
    }
    const entry = (d.enqueue ?? enqueueOutbox)(repoRoot, "indexnow", {
      urls, host: new URL(prev.startUrl).host,
    });
    return {
      ...metrics, verified: true, level: "L3", outboxId: entry.id,
      evidence: `outbox indexnow ${entry.id} ${urls.length} urls`,
      detail: `outbox ${entry.id}：提交 ${urls.length} 条，剔除 ${rejected.length} 条；请运行 kunpeng outbox flush indexnow 人工放行`,
    };
  }

  throw new Error(`unsupported lever: ${lever}`);
}
