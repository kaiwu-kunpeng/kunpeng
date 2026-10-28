import { join } from "node:path";
import { buildAiCrawlerReport } from "./ai-crawler-report.js";
import { crawlSite, type CrawlOptions } from "./crawl.js";
import {
  fetchRetractionSweep, fetchRobotsGate, runCanonicalTargetGate, runDiscoveryLiveness, runFirstHtmlGate,
  runGeoCitabilityGate, runHreflangCluster, runSerpBudgetGate, runSitemapOrphanGate, runStructuredDataGate,
  type FirstHtmlExpectation, type RobotsPolicy, type SerpPage,
} from "./gates/index.js";
import { enqueueOutbox } from "../loop/outbox.js";
import { gscTools } from "./gsc.js";
import { buildLinkGraph } from "./link-graph.js";
import { defineSeoTool, type SeoToolContext, type SeoToolDef } from "./mcp-server.js";
import { auditPageHtml } from "./page-audit.js";
import { buildSiteReport, loadSitemapUrls, summarizeSiteReport, writeSiteReport } from "./report.js";

const USER_AGENT = "kunpeng-seo/0.1";

function crawlOptions(args: Record<string, unknown>, ctx: SeoToolContext): CrawlOptions {
  return {
    startUrl: typeof args.startUrl === "string" ? args.startUrl : "",
    maxPages: Math.min(Math.max(1, typeof args.maxPages === "number" ? args.maxPages : 200), 500),
    maxDepth: typeof args.maxDepth === "number" ? args.maxDepth : 10,
    respectRobots: typeof args.respectRobots === "boolean" ? args.respectRobots : true,
    userAgent: USER_AGENT,
    fetchImpl: ctx.fetchImpl,
  };
}

function compareRankedUrls([a, aValue]: [string, number], [b, bValue]: [string, number]): number {
  return bValue - aValue || (a < b ? -1 : a > b ? 1 : 0);
}

export function builtinSeoTools(): SeoToolDef[] {
  return [defineSeoTool({
    name: "seo_audit_page",
    description: "抓取单页并审计页面内容、编码与 SEO 基础问题。",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    run: async (args, ctx) => {
      const url = typeof args.url === "string" ? args.url : "";
      const res = await ctx.fetchImpl(url, {
        headers: { "user-agent": USER_AGENT }, redirect: "follow",
      });
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
      const httpCharset = res.headers.get("content-type")?.match(/charset=([^;\s]+)/i)?.[1];
      return JSON.stringify(auditPageHtml(await res.text(), {
        url, ...(httpCharset === undefined ? {} : { httpCharset }),
      }));
    },
  }), defineSeoTool({
    name: "seo_geo_citability",
    description: "按 kp-geo-v1 逐页评估 GEO 可引用度，汇总可观测信号得分与改进项。",
    inputSchema: {
      type: "object",
      properties: { urls: { type: "array", items: { type: "string" } } },
      required: ["urls"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    run: async (args, ctx) => {
      const urls = Array.isArray(args.urls)
        ? args.urls.filter((url): url is string => typeof url === "string") : [];
      const pages: Array<{ url: string; html: string }> = [];
      const failed: Array<{ url: string; status: number }> = [];
      for (const url of urls) {
        try {
          const res = await ctx.fetchImpl(url, {
            headers: { "user-agent": USER_AGENT }, redirect: "follow",
          });
          if (res.status === 200) pages.push({ url, html: await res.text() });
          else failed.push({ url, status: res.status });
        } catch {
          failed.push({ url, status: 0 });
        }
      }
      const gateResult = runGeoCitabilityGate(pages, ctx.now());
      return JSON.stringify({ ...gateResult, failed });
    },
  }), defineSeoTool({
    name: "seo_crawl_site",
    description: "抓取站内页面并汇总状态码、抓取深度与 robots 拦截情况。",
    inputSchema: {
      type: "object",
      properties: {
        startUrl: { type: "string" },
        maxPages: { type: "number" },
        maxDepth: { type: "number" },
        respectRobots: { type: "boolean" },
      },
      required: ["startUrl"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    run: async (args, ctx) => {
      const { startUrl, pages, blockedByRobots } = await crawlSite(crawlOptions(args, ctx));
      const statusCounts: Record<string, number> = {};
      for (const page of pages) {
        const status = String(page.status);
        statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      }
      return JSON.stringify({
        startUrl,
        pageCount: pages.length,
        statusCounts,
        blockedByRobots,
        pages: pages.map(({ url, status, depth, title }) => ({ url, status, depth, title })),
      });
    },
  }), defineSeoTool({
    name: "seo_internal_links",
    description: "结合站内抓取与 sitemap 检查孤儿页、漏列页、断链及内链排名。",
    inputSchema: {
      type: "object",
      properties: {
        startUrl: { type: "string" },
        maxPages: { type: "number" },
        sitemapUrl: { type: "string" },
        maxDepthOk: { type: "number" },
      },
      required: ["startUrl"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    run: async (args, ctx) => {
      const crawl = await crawlSite(crawlOptions({ startUrl: args.startUrl, maxPages: args.maxPages }, ctx));
      const sitemapUrl = typeof args.sitemapUrl === "string"
        ? args.sitemapUrl : `${new URL(crawl.startUrl).origin}/sitemap.xml`;
      const sitemapUrls = await loadSitemapUrls(sitemapUrl, { fetchImpl: ctx.fetchImpl, userAgent: USER_AGENT });
      const graph = buildLinkGraph({
        pages: crawl.pages,
        edges: crawl.edges,
        sitemapUrls,
        startUrl: crawl.startUrl,
        ...(typeof args.maxDepthOk === "number" ? { maxDepthOk: args.maxDepthOk } : {}),
      });
      return JSON.stringify({
        startUrl: crawl.startUrl,
        pageCount: crawl.pages.length,
        sitemapStatus: sitemapUrls === undefined ? "missing" : "ok",
        sitemapCount: sitemapUrls?.length ?? 0,
        orphans: graph.orphans,
        notInSitemap: graph.notInSitemap,
        broken: graph.broken,
        deep: graph.deep,
        blockedByRobots: crawl.blockedByRobots,
        topInbound: Object.entries(graph.inbound).sort(compareRankedUrls).slice(0, 20)
          .map(([url, inbound]) => ({ url, inbound })),
        topPageRank: Object.entries(graph.pageRank).sort(compareRankedUrls).slice(0, 20)
          .map(([url, pageRank]) => ({ url, pageRank: Number(pageRank.toFixed(4)) })),
        zeroInbound: crawl.pages
          .filter(({ url }) => url !== crawl.startUrl && graph.inbound[url] === 0)
          .map(({ url }) => url).sort(),
      });
    },
  }), ...gscTools(), defineSeoTool({
    name: "seo_sitemap_gate",
    description: "结合站内抓取与 sitemap 裁决孤儿页、漏列页及过深页面，支持路径前缀豁免。",
    inputSchema: {
      type: "object",
      properties: {
        startUrl: { type: "string" },
        maxPages: { type: "number" },
        sitemapUrl: { type: "string" },
        allow: { type: "array", items: { type: "string" } },
        maxDepthOk: { type: "number" },
      },
      required: ["startUrl"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    run: async (args, ctx) => {
      const crawl = await crawlSite(crawlOptions({ startUrl: args.startUrl, maxPages: args.maxPages }, ctx));
      const sitemapUrl = typeof args.sitemapUrl === "string"
        ? args.sitemapUrl : `${new URL(crawl.startUrl).origin}/sitemap.xml`;
      const loaded = await loadSitemapUrls(sitemapUrl, { fetchImpl: ctx.fetchImpl, userAgent: USER_AGENT });
      const sitemapUrls = loaded ?? [];
      const allow = Array.isArray(args.allow)
        ? args.allow.filter((prefix): prefix is string => typeof prefix === "string") : [];
      const gateResult = runSitemapOrphanGate({
        pages: crawl.pages,
        edges: crawl.edges,
        sitemapUrls,
        startUrl: crawl.startUrl,
        allow,
        ...(typeof args.maxDepthOk === "number" ? { maxDepthOk: args.maxDepthOk } : {}),
      });
      return JSON.stringify({
        startUrl: crawl.startUrl,
        pageCount: crawl.pages.length,
        sitemapStatus: loaded === undefined ? "missing" : "ok",
        ...gateResult,
      });
    },
  }), defineSeoTool({
    name: "seo_first_html_check",
    description: "检查首次返回的 HTML 是否包含预期内容，识别 JavaScript 空壳页面。",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        expectations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              text: { type: "string" },
              regex: { type: "string" },
              selector: { type: "string" },
            },
            required: ["id"],
            additionalProperties: false,
          },
        },
        minWords: { type: "number" },
      },
      required: ["url", "expectations"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    run: async (args, ctx) => {
      const expectations: FirstHtmlExpectation[] = Array.isArray(args.expectations)
        ? args.expectations.flatMap((entry: unknown) => {
          if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
          const item = entry as Record<string, unknown>;
          if (typeof item.id !== "string") return [];
          return [{
            id: item.id,
            ...(typeof item.text === "string" ? { text: item.text } : {}),
            ...(typeof item.regex === "string" ? { regex: item.regex } : {}),
            ...(typeof item.selector === "string" ? { selector: item.selector } : {}),
          }];
        }) : [];
      const result = await runFirstHtmlGate({
        url: typeof args.url === "string" ? args.url : "",
        expectations,
        ...(typeof args.minWords === "number" ? { minWords: args.minWords } : {}),
        fetchImpl: ctx.fetchImpl,
        userAgent: USER_AGENT,
      });
      return JSON.stringify(result);
    },
  }), defineSeoTool({
    name: "seo_robots_check",
    description: "检查 robots.txt 对训练、搜索与用户触发爬虫的访问策略及 sitemap 声明。",
    inputSchema: {
      type: "object",
      properties: {
        origin: { type: "string" },
        policy: {
          type: "object",
          properties: {
            training: { type: "string" },
            search: { type: "string" },
            user: { type: "string" },
          },
          additionalProperties: false,
        },
        requireSitemap: { type: "boolean" },
      },
      required: ["origin"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    run: async (args, ctx) => {
      const origin = new URL(String(args.origin)).origin;
      const policy: RobotsPolicy = {};
      if (typeof args.policy === "object" && args.policy !== null && !Array.isArray(args.policy)) {
        const { training, search, user } = args.policy as Record<string, unknown>;
        if (training === "allow" || training === "block" || training === "any") policy.training = training;
        if (search === "allow" || search === "any") policy.search = search;
        if (user === "allow" || user === "any") policy.user = user;
      }
      const result = await fetchRobotsGate({
        origin,
        fetchImpl: ctx.fetchImpl,
        userAgent: USER_AGENT,
        policy,
        ...(typeof args.requireSitemap === "boolean" ? { requireSitemap: args.requireSitemap } : {}),
      });
      return JSON.stringify(result);
    },
  }), defineSeoTool({
    name: "seo_ai_crawler_report",
    description: "读取 AI 爬虫日志，汇总爬虫类别、逐日趋势与搜索抓取到用户取页的选择漏斗。",
    inputSchema: {
      type: "object",
      properties: { site: { type: "string" }, sinceDays: { type: "number" }, limit: { type: "number" } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    run: async (args, ctx) => {
      if (!ctx.sqlRunner) {
        return JSON.stringify({ ok: false, error: "NEON_DATABASE_URL 未配置，无法读取 ai_crawler_hits" });
      }
      const sinceDays = typeof args.sinceDays === "number" && Number.isFinite(args.sinceDays) ? Math.trunc(args.sinceDays) : 7;
      const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? Math.trunc(args.limit) : 20;
      const report = await buildAiCrawlerReport(ctx.sqlRunner, {
        ...(typeof args.site === "string" ? { site: args.site } : {}),
        sinceDays: Math.min(90, Math.max(1, sinceDays)),
        limit: Math.min(100, Math.max(1, limit)),
      });
      return JSON.stringify({ ok: true, ...report });
    },
  }), defineSeoTool({
    name: "seo_retraction_sweep",
    description: "抓取页面与发现层文本，检查撤稿词条是否仍有残留。",
    inputSchema: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" } },
        terms: { type: "array", items: { type: "string" } },
        discoveryUrls: { type: "array", items: { type: "string" } },
      },
      required: ["urls", "terms"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    run: async (args, ctx) => {
      const urls = Array.isArray(args.urls)
        ? args.urls.filter((url): url is string => typeof url === "string") : [];
      const terms = Array.isArray(args.terms)
        ? args.terms.filter((term): term is string => typeof term === "string") : [];
      const discoveryUrls = Array.isArray(args.discoveryUrls)
        ? args.discoveryUrls.filter((url): url is string => typeof url === "string") : [];
      const result = await fetchRetractionSweep({
        urls, terms, discoveryUrls, fetchImpl: ctx.fetchImpl, userAgent: USER_AGENT,
      });
      return JSON.stringify(result);
    },
  }), defineSeoTool({
    name: "seo_hreflang_cluster",
    description: "检查 hreflang 集合的语言码、互相回指、目标状态、canonical 与页面语言。",
    inputSchema: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" } },
        maxTargets: { type: "number" },
      },
      required: ["urls"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    run: async (args, ctx) => {
      const urls = Array.isArray(args.urls)
        ? args.urls.filter((url): url is string => typeof url === "string") : [];
      const result = await runHreflangCluster({
        urls, fetchImpl: ctx.fetchImpl, userAgent: USER_AGENT,
        ...(typeof args.maxTargets === "number" ? { maxTargets: args.maxTargets } : {}),
      });
      return JSON.stringify(result);
    },
  }), defineSeoTool({
    name: "seo_discovery_check",
    description: "检查 llms.txt、robots.txt、Link 头与 JSON-LD 发现的 URL 是否可达。",
    inputSchema: {
      type: "object",
      properties: {
        origin: { type: "string" },
        includeExternal: { type: "boolean" },
        maxUrls: { type: "number" },
      },
      required: ["origin"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    run: async (args, ctx) => {
      const result = await runDiscoveryLiveness({
        origin: String(args.origin),
        fetchImpl: ctx.fetchImpl,
        userAgent: USER_AGENT,
        ...(typeof args.includeExternal === "boolean" ? { includeExternal: args.includeExternal } : {}),
        ...(typeof args.maxUrls === "number" ? { maxUrls: args.maxUrls } : {}),
      });
      return JSON.stringify(result);
    },
  }), defineSeoTool({
    name: "seo_structured_data",
    description: "逐页抓取 HTML，抽取 JSON-LD 并检查富结果必填、推荐字段及受限或已下线类型。",
    inputSchema: {
      type: "object",
      properties: { urls: { type: "array", items: { type: "string" } } },
      required: ["urls"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    run: async (args, ctx) => {
      const urls = Array.isArray(args.urls)
        ? args.urls.filter((url): url is string => typeof url === "string") : [];
      const pages: Array<{ url: string; html: string }> = [];
      const failed: Array<{ url: string; status: number }> = [];
      for (const url of urls) {
        try {
          const res = await ctx.fetchImpl(url, {
            headers: { "user-agent": USER_AGENT }, redirect: "follow",
          });
          if (res.status === 200) pages.push({ url, html: await res.text() });
          else failed.push({ url, status: res.status });
        } catch {
          failed.push({ url, status: 0 });
        }
      }
      const gateResult = runStructuredDataGate(pages);
      return JSON.stringify({ ...gateResult, failed });
    },
  }), defineSeoTool({
    name: "seo_serp_budget",
    description: "逐页抓取 HTML，检查 SERP 标题与描述预算、重复内容及分享图片。",
    inputSchema: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" } },
        titleMax: { type: "number" },
        descriptionMin: { type: "number" },
        descriptionMax: { type: "number" },
      },
      required: ["urls"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    run: async (args, ctx) => {
      const urls = Array.isArray(args.urls)
        ? args.urls.filter((url): url is string => typeof url === "string") : [];
      const pages: SerpPage[] = [];
      const failed: Array<{ url: string; status: number }> = [];
      for (const url of urls) {
        try {
          const res = await ctx.fetchImpl(url, {
            headers: { "user-agent": USER_AGENT }, redirect: "follow",
          });
          if (res.status === 200) pages.push({ url, html: await res.text() });
          else failed.push({ url, status: res.status });
        } catch {
          failed.push({ url, status: 0 });
        }
      }
      const result = runSerpBudgetGate(pages, {
        ...(typeof args.titleMax === "number" ? { titleMax: args.titleMax } : {}),
        ...(typeof args.descriptionMin === "number" ? { descriptionMin: args.descriptionMin } : {}),
        ...(typeof args.descriptionMax === "number" ? { descriptionMax: args.descriptionMax } : {}),
      });
      const findings = [...result.findings];
      for (const { url, status } of failed) {
        findings.push({
          rule: "serp-fetch-failed",
          severity: "warn",
          message: `SERP page could not be fetched at ${url}: status ${status}.`,
          evidence: url,
        });
      }
      return JSON.stringify({ ...result, findings, failed });
    },
  }), defineSeoTool({
    name: "seo_canonical_check",
    description: "逐页抓取 HTML，核验 canonical 指向的目标可达、非 noindex、不成链且标题相似。",
    inputSchema: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" } },
        similarityMin: { type: "number" },
      },
      required: ["urls"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    run: async (args, ctx) => {
      const urls = Array.isArray(args.urls)
        ? args.urls.filter((url): url is string => typeof url === "string") : [];
      const pages: Array<{ url: string; html: string }> = [];
      const failed: Array<{ url: string; status: number }> = [];
      for (const url of urls) {
        try {
          const res = await ctx.fetchImpl(url, {
            headers: { "user-agent": USER_AGENT }, redirect: "follow",
          });
          if (res.status === 200) pages.push({ url, html: await res.text() });
          else failed.push({ url, status: res.status });
        } catch {
          failed.push({ url, status: 0 });
        }
      }
      const result = await runCanonicalTargetGate(pages, {
        fetchImpl: ctx.fetchImpl,
        userAgent: USER_AGENT,
        ...(typeof args.similarityMin === "number" ? { similarityMin: args.similarityMin } : {}),
      });
      const findings = [...result.findings];
      for (const { url, status } of failed) {
        findings.push({
          rule: "canonical-fetch-failed",
          severity: "warn",
          message: `Page could not be fetched for canonical check at ${url}: status ${status}.`,
          evidence: url,
        });
      }
      return JSON.stringify({ ...result, findings, failed });
    },
  }), defineSeoTool({
    name: "seo_site_report",
    description: "生成整站 SEO 审计报告，保存 JSON 与 Markdown 并返回摘要及文件路径。",
    inputSchema: {
      type: "object",
      properties: {
        origin: { type: "string" },
        maxPages: { type: "number" },
        sitemapUrl: { type: "string" },
        allow: { type: "array", items: { type: "string" } },
        terms: { type: "array", items: { type: "string" } },
        outDir: { type: "string" },
      },
      required: ["origin"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    run: async (args, ctx) => {
      const allow = Array.isArray(args.allow)
        ? args.allow.filter((prefix): prefix is string => typeof prefix === "string") : [];
      const terms = Array.isArray(args.terms)
        ? args.terms.filter((term): term is string => typeof term === "string") : [];
      const report = await buildSiteReport({
        origin: String(args.origin),
        fetchImpl: ctx.fetchImpl,
        userAgent: USER_AGENT,
        now: ctx.now,
        allow,
        terms,
        ...(typeof args.maxPages === "number" ? { maxPages: args.maxPages } : {}),
        ...(typeof args.sitemapUrl === "string" ? { sitemapUrl: args.sitemapUrl } : {}),
      });
      const outDir = typeof args.outDir === "string" && args.outDir.length > 0
        ? args.outDir : join(ctx.repoRoot, ".kunpeng", "seo-reports");
      const files = await writeSiteReport(report, outDir);
      return JSON.stringify(summarizeSiteReport(report, files));
    },
  }), defineSeoTool({
    name: "seo_indexnow_submit",
    description: "把 IndexNow 提交请求排进 outbox（不直接外发），由 kunpeng outbox flush indexnow 人工放行后外发。",
    inputSchema: {
      type: "object",
      properties: {
        host: { type: "string" },
        key: { type: "string" },
        urls: { type: "array", items: { type: "string" } },
        keyLocation: { type: "string" },
      },
      required: ["host", "urls"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    run: async (args, ctx) => {
      const urls = [...new Set(Array.isArray(args.urls)
        ? args.urls.filter((url): url is string => typeof url === "string")
        : [])];
      const entry = enqueueOutbox(ctx.repoRoot, "indexnow", {
        urls,
        host: typeof args.host === "string" ? args.host : "",
        ...(typeof args.keyLocation === "string" ? { keyLocation: args.keyLocation } : {}),
      });
      return JSON.stringify({
        queued: true,
        id: entry.id,
        channel: "indexnow",
        urls: urls.length,
        note: "已入 outbox，待 kunpeng outbox flush indexnow 人工放行后外发（flush 需 INDEXNOW_KEY）",
      });
    },
  })];
}