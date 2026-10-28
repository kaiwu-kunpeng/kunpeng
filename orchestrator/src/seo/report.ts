import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crawlSite, type CrawlPage } from "./crawl.js";
import {
  checkFirstHtml, fetchRobotsGate, runCanonicalTargetGate, runDiscoveryLiveness, runRetractionSweep, runSerpBudgetGate,
  runSitemapOrphanGate,
  type DiscoveryLivenessResult, type DuplicateGroup, type RetractionSweepResult, type RobotsGateResult,
  type SitemapOrphanGateResult,
} from "./gates/index.js";
import { parseSitemapIndex, parseSitemapUrls } from "./link-graph.js";
import { auditPageHtml, type Finding } from "./page-audit.js";

const DEFAULT_USER_AGENT = "kunpeng-seo/0.1";

export interface SiteReportOptions {
  origin: string;
  fetchImpl?: typeof fetch;
  userAgent?: string;
  maxPages?: number;
  sitemapUrl?: string;
  allow?: string[];
  terms?: string[];
  minWords?: number;
  now?: () => number;
}

export interface LayerSummary {
  id: string;
  label: string;
  ok: boolean;
  errors: number;
  warns: number;
  infos: number;
}

export interface SiteReport {
  origin: string;
  generatedAt: string;
  crawl: { pageCount: number; statusCounts: Record<string, number>; blockedByRobots: string[]; seconds: number };
  redirects: Array<{ from: string; to: string }>;
  layers: LayerSummary[];
  robots: RobotsGateResult & { status: number };
  discovery: DiscoveryLivenessResult;
  sitemap: SitemapOrphanGateResult & { sitemapStatus: "ok" | "missing" };
  pageAudit: {
    audited: number;
    ruleCounts: Record<string, number>;
    worst: Array<{ url: string; errors: number; warns: number; rules: string[] }>;
  };
  serp: {
    ok: boolean;
    ruleCounts: Record<string, number>;
    overBudget: Array<{ url: string; length: number; title: string }>;
    duplicateTitles: DuplicateGroup[];
    duplicateDescriptions: DuplicateGroup[];
  };
  canonical: { ok: boolean; checked: number; fetched: number; ruleCounts: Record<string, number>; findings: Finding[] };
  firstHtml: { checked: number; shellPages: string[] };
  retraction?: RetractionSweepResult;
  totals: { errors: number; warns: number; infos: number; ok: boolean };
}

export interface WriteReportResult {
  jsonPath: string;
  markdownPath: string;
}

async function readSitemap(url: string, fetchImpl: typeof fetch, userAgent: string): Promise<string | undefined> {
  try {
    const res = await fetchImpl(url, { headers: { "user-agent": userAgent }, redirect: "follow" });
    if (res.status < 200 || res.status >= 300) return undefined;
    return await res.text();
  } catch {
    // Sitemap 获取失败按契约降级；子 sitemap 失败仅跳过当前文件。
    return undefined;
  }
}

export async function loadSitemapUrls(
  sitemapUrl: string,
  ctx: { fetchImpl: typeof fetch; userAgent?: string },
): Promise<string[] | undefined> {
  const userAgent = ctx.userAgent ?? DEFAULT_USER_AGENT;
  const xml = await readSitemap(sitemapUrl, ctx.fetchImpl, userAgent);
  if (xml === undefined) return undefined;
  const index = parseSitemapIndex(xml);
  if (index.length === 0) return parseSitemapUrls(xml);
  const urls = new Set<string>();
  for (const url of index.slice(0, 20)) {
    const childXml = await readSitemap(url, ctx.fetchImpl, userAgent);
    if (childXml === undefined) continue;
    for (const childUrl of parseSitemapUrls(childXml)) urls.add(childUrl);
  }
  return [...urls];
}

function countFindings(findings: Finding[]): { errors: number; warns: number; infos: number } {
  const counts = { errors: 0, warns: 0, infos: 0 };
  for (const finding of findings) {
    if (finding.severity === "error") counts.errors++;
    else if (finding.severity === "warn") counts.warns++;
    else counts.infos++;
  }
  return counts;
}

function layerOf(id: string, label: string, counts: { errors: number; warns: number; infos: number }): LayerSummary {
  return { id, label, ok: counts.errors === 0, ...counts };
}

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

export async function buildSiteReport(opts: SiteReportOptions): Promise<SiteReport> {
  const {
    fetchImpl = fetch, userAgent = DEFAULT_USER_AGENT, maxPages = 300, allow = [], terms = [],
    minWords = 150, now = Date.now,
  } = opts;
  const origin = new URL(opts.origin).origin;
  const startedAt = now();
  const crawl = await crawlSite({ startUrl: `${origin}/`, fetchImpl, maxPages, userAgent, keepHtml: true, concurrency: 6 });
  const seconds = Math.round((now() - startedAt) / 1000);
  const statusCounts: Record<string, number> = {};
  for (const page of crawl.pages) bump(statusCounts, String(page.status));
  const redirects = crawl.pages.flatMap((page) => page.finalUrl === undefined ? [] : [{ from: page.url, to: page.finalUrl }]);
  const htmlPages = crawl.pages.filter(
    (page): page is CrawlPage & { html: string } => page.finalUrl === undefined && typeof page.html === "string",
  );

  const robots = await fetchRobotsGate({ origin, fetchImpl, userAgent });
  const discovery = await runDiscoveryLiveness({ origin, fetchImpl, userAgent });

  const sitemapUrl = opts.sitemapUrl ?? `${origin}/sitemap.xml`;
  const loaded = await loadSitemapUrls(sitemapUrl, { fetchImpl, userAgent });
  const sitemapGate = runSitemapOrphanGate({
    pages: crawl.pages, edges: crawl.edges, sitemapUrls: loaded ?? [], startUrl: crawl.startUrl, allow,
  });
  const sitemap = { ...sitemapGate, sitemapStatus: loaded === undefined ? "missing" as const : "ok" as const };

  const pageRuleCounts: Record<string, number> = {};
  const pageCounts = { errors: 0, warns: 0, infos: 0 };
  const perPage: Array<{ url: string; errors: number; warns: number; rules: string[] }> = [];
  for (const { url, html, contentType } of htmlPages) {
    const httpCharset = /charset=([^;\s]+)/i.exec(contentType)?.[1];
    const audit = auditPageHtml(html, { url, ...(httpCharset === undefined ? {} : { httpCharset }) });
    const counts = countFindings(audit.findings);
    pageCounts.errors += counts.errors;
    pageCounts.warns += counts.warns;
    pageCounts.infos += counts.infos;
    for (const finding of audit.findings) bump(pageRuleCounts, finding.rule);
    if (audit.findings.length > 0) {
      perPage.push({ url, errors: counts.errors, warns: counts.warns, rules: [...new Set(audit.findings.map((f) => f.rule))] });
    }
  }
  perPage.sort((a, b) => b.errors - a.errors || b.warns - a.warns || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));

  const serpGate = runSerpBudgetGate(htmlPages.map(({ url, html }) => ({ url, html })));
  const serpRuleCounts: Record<string, number> = {};
  for (const finding of serpGate.findings) bump(serpRuleCounts, finding.rule);
  const overBudget = serpGate.pages
    .filter((page) => page.titleLength > 60)
    .sort((a, b) => b.titleLength - a.titleLength || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
    .map((page) => ({ url: page.url, length: page.titleLength, title: page.title ?? "" }));

  const canonicalGate = await runCanonicalTargetGate(htmlPages.map(({ url, html }) => ({ url, html })), { fetchImpl, userAgent });
  const canonicalRuleCounts: Record<string, number> = {};
  for (const finding of canonicalGate.findings) bump(canonicalRuleCounts, finding.rule);

  const firstHtmlCounts = { errors: 0, warns: 0, infos: 0 };
  const shellPages: string[] = [];
  for (const { url, html } of htmlPages) {
    const check = checkFirstHtml({ url, html, expectations: [], minWords });
    if (check.shell) shellPages.push(url);
    const counts = countFindings(check.findings);
    firstHtmlCounts.errors += counts.errors;
    firstHtmlCounts.warns += counts.warns;
    firstHtmlCounts.infos += counts.infos;
  }
  shellPages.sort();

  const retraction = terms.length > 0
    ? runRetractionSweep({ pages: htmlPages.map(({ url, html }) => ({ url, html })), terms })
    : undefined;

  const layers: LayerSummary[] = [
    layerOf("robots", "robots 三态", countFindings(robots.findings)),
    layerOf("discovery", "发现层存活", countFindings(discovery.findings)),
    layerOf("sitemap", "sitemap 孤儿", countFindings(sitemap.findings)),
    layerOf("page-audit", "页面代码审计", pageCounts),
    layerOf("serp", "SERP 行预算", countFindings(serpGate.findings)),
    layerOf("canonical", "canonical 目标", countFindings(canonicalGate.findings)),
    layerOf("first-html", "首个 HTML", firstHtmlCounts),
  ];
  if (retraction !== undefined) layers.push(layerOf("retraction", "撤稿扫描", countFindings(retraction.findings)));

  const totals = layers.reduce(
    (acc, layer) => ({ errors: acc.errors + layer.errors, warns: acc.warns + layer.warns, infos: acc.infos + layer.infos, ok: true }),
    { errors: 0, warns: 0, infos: 0, ok: true },
  );
  totals.ok = totals.errors === 0;

  return {
    origin,
    generatedAt: new Date(now()).toISOString(),
    crawl: { pageCount: crawl.pages.length, statusCounts, blockedByRobots: crawl.blockedByRobots, seconds },
    redirects,
    layers,
    robots,
    discovery,
    sitemap,
    pageAudit: { audited: htmlPages.length, ruleCounts: pageRuleCounts, worst: perPage.slice(0, 20) },
    serp: {
      ok: serpGate.ok, ruleCounts: serpRuleCounts, overBudget,
      duplicateTitles: serpGate.duplicateTitles, duplicateDescriptions: serpGate.duplicateDescriptions,
    },
    canonical: {
      ok: canonicalGate.ok, checked: canonicalGate.checked, fetched: canonicalGate.fetched,
      ruleCounts: canonicalRuleCounts, findings: canonicalGate.findings,
    },
    firstHtml: { checked: htmlPages.length, shellPages },
    ...(retraction === undefined ? {} : { retraction }),
    totals,
  };
}

const ADVICE: Record<string, string> = {
  "sitemap-orphan": "sitemap 里列出的页面没有任何站内入链，是孤儿页：给它们加导航或相关页链接，或从 sitemap 移除。",
  "sitemap-empty": "sitemap 缺失或为空：补上 sitemap.xml 并在 robots.txt 里声明。",
  "robots-wildcard-block-all": "robots.txt 对所有爬虫 Disallow: /，整站不可被抓取：删掉该规则或改成只封私有路径。",
  "robots-search-blocked": "AI 搜索类爬虫被 robots.txt 拦住，站点不会出现在 AI 搜索答案里：放开对应 User-agent。",
  "robots-user-blocked": "用户触发类爬虫被拦，用户在 AI 里贴链接时读不到内容：放开对应 User-agent。",
  "robots-status": "robots.txt 返回异常状态码：修到 200 或 404。",
  "discovery-dead-url": "llms.txt / robots / Link 头 / JSON-LD 里声明的 URL 有死链：更新声明或恢复页面。",
  "discovery-source-unreachable": "发现层来源文件无法读取：确认 llms.txt 与 robots.txt 可访问。",
  "serp-title-over-budget": "标题超过 60 字符会在搜索结果里被截断：缩短标题或去掉站名后缀。",
  "serp-title-missing": "页面缺少 <title>：为每页设置唯一标题。",
  "serp-title-duplicate": "多页共用同一标题会互相争排名：让每页标题唯一。",
  "serp-description-over-budget": "描述超过 160 字符会被截断：压缩到 150 字符以内。",
  "title-missing": "页面缺少 <title>：为每页设置唯一标题。",
  "description-missing": "页面缺少 meta description：补一句 70–150 字符的摘要。",
  "h1-missing": "页面没有 H1：每页放一个与标题呼应的 H1。",
  "h1-multiple": "页面有多个 H1：只保留一个。",
  "html-lang-missing": "<html> 缺 lang 属性：按页面语言补上，多语言站点尤其重要。",
  "mojibake": "页面出现乱码替换符：检查源文件编码与传输编码是否一致。",
  "charset-mismatch": "HTTP 头与 <meta charset> 声明的编码不一致：统一为 UTF-8。",
  "charset-missing": "页面没有声明编码：加 <meta charset=\"utf-8\">。",
  "canonical-missing": "页面缺少 canonical：为每页声明规范 URL。",
  "noindex": "页面带 noindex：确认是否有意排除出索引。",
  "canonical-target-unreachable": "canonical 指向的 URL 打不开：页面会随目标一起掉出索引，改成指向可达的终态页或自指。",
  "canonical-target-noindex": "canonical 指向了 noindex 的页：两个 URL 都不会被收录，改指可收录的页。",
  "canonical-chain": "canonical 成链（A→B→C）：直接指向最终页。",
  "canonical-target-dissimilar": "canonical 指向了内容不相关的页：这是把本页拱手让出索引，核对模板里的 canonical 取值。",
  "first-html-shell": "首个 HTML 几乎没有正文，是 JavaScript 空壳：改为服务端渲染或静态生成，让爬虫第一眼就能读到内容。",
  "first-html-empty-root": "首个 HTML 的应用根节点为空：改为服务端渲染。",
  "first-html-status": "页面首个响应不是 200：修复状态码。",
  "retraction-hit": "已撤稿的说法仍残留在页面或发现层：逐面清除并重新提交。",
  "retraction-unverified": "部分页面抓不到，撤稿清除无法确认：修复页面后重跑。",
};

function table(header: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}

function countTable(counts: Record<string, number>): string {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([rule, n]) => [rule, String(n)]);
  return rows.length === 0 ? "无。" : table(["规则", "次数"], rows);
}

function list(items: string[], limit: number): string {
  if (items.length === 0) return "无。";
  const shown = items.slice(0, limit).map((item) => `- ${item}`);
  if (items.length > limit) shown.push(`- …另 ${items.length - limit} 条见 JSON`);
  return shown.join("\n");
}

function errorRules(report: SiteReport): Map<string, number> {
  const rules = new Map<string, number>();
  const add = (findings: Finding[]) => {
    for (const f of findings) if (f.severity === "error") rules.set(f.rule, (rules.get(f.rule) ?? 0) + 1);
  };
  add(report.robots.findings);
  add(report.discovery.findings);
  add(report.sitemap.findings);
  if (report.retraction !== undefined) add(report.retraction.findings);
  add(report.canonical.findings);
  for (const [rule, n] of Object.entries(report.serp.ruleCounts)) {
    if (rule.endsWith("-over-budget") || rule.endsWith("-missing") || rule.endsWith("-duplicate")) rules.set(rule, (rules.get(rule) ?? 0) + n);
  }
  for (const rule of ["title-missing", "h1-missing", "html-lang-missing", "mojibake", "charset-mismatch", "charset-missing", "noindex", "canonical-missing", "description-missing", "h1-multiple"]) {
    const n = report.pageAudit.ruleCounts[rule];
    if (n !== undefined && n > 0) rules.set(rule, (rules.get(rule) ?? 0) + n);
  }
  if (report.firstHtml.shellPages.length > 0) rules.set("first-html-shell", report.firstHtml.shellPages.length);
  return rules;
}

export function renderSiteReportMarkdown(report: SiteReport): string {
  const light = report.totals.ok ? "✅ 通过" : "❌ 未通过";
  const out: string[] = [
    `# SEO 审计报告：${report.origin}`,
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 抓取 ${report.crawl.pageCount} 页，用时 ${report.crawl.seconds} 秒；状态码 ${Object.entries(report.crawl.statusCounts).map(([s, n]) => `${s}×${n}`).join("，") || "无"}；robots 拦截 ${report.crawl.blockedByRobots.length} 条`,
    `- 总灯：${light}（error ${report.totals.errors} / warn ${report.totals.warns} / info ${report.totals.infos}）`,
    "",
    "## 分层结果",
    "",
    table(["层", "结果", "error", "warn", "info"], report.layers.map((l) => [l.label, l.ok ? "✅" : "❌", String(l.errors), String(l.warns), String(l.infos)])),
    "",
    "## robots 三态",
    "",
    `robots.txt 状态 ${report.robots.status}；sitemap 声明：${report.robots.sitemaps.join("，") || "无"}；通配封锁：${report.robots.wildcardBlocksAll ? "是" : "否"}。`,
    "",
    table(["爬虫", "类别", "裁决"], report.robots.reports.map((r) => [r.agent, r.class, r.verdict])),
    "",
    "## 发现层存活",
    "",
    `来源：${Object.entries(report.discovery.sources).map(([s, n]) => `${s} ${n}`).join("，")}；探测 ${report.discovery.probes.length} 条。`,
    "",
    "死链：",
    list(report.discovery.probes.filter((p) => !p.ok).map((p) => `${p.url}（${p.source}，${p.status}）`), 50),
    "",
    "## sitemap 孤儿",
    "",
    `sitemap ${report.sitemap.sitemapStatus === "ok" ? "可读" : "缺失"}，列出 ${report.sitemap.sitemapCount} 条，其中有入链 ${report.sitemap.linkedCount} 条；豁免 ${report.sitemap.ignored.length} 条。`,
    "",
    "孤儿页：",
    list(report.sitemap.orphans, 20),
    "",
    "抓到但 sitemap 漏列：",
    list(report.sitemap.notInSitemap, 20),
    "",
    "过深页：",
    list(report.sitemap.deep, 20),
    "",
    "## 页面代码审计",
    "",
    `审计 ${report.pageAudit.audited} 页。`,
    "",
    countTable(report.pageAudit.ruleCounts),
    "",
    report.pageAudit.worst.length === 0 ? "所有页面无发现。" : table(["页面", "error", "warn", "命中规则"], report.pageAudit.worst.map((w) => [w.url, String(w.errors), String(w.warns), w.rules.join(", ")])),
    "",
    "## SERP 行预算",
    "",
    countTable(report.serp.ruleCounts),
    "",
    "超预算标题：",
    report.serp.overBudget.length === 0 ? "无。" : table(["页面", "长度", "标题"], report.serp.overBudget.slice(0, 30).map((o) => [o.url, String(o.length), o.title])),
    "",
    "重复标题组：",
    list(report.serp.duplicateTitles.map((g) => `${g.key} ← ${g.urls.join("，")}`), 20),
    "",
    "重复描述组：",
    list(report.serp.duplicateDescriptions.map((g) => `${g.key} ← ${g.urls.join("，")}`), 20),
    "",
    "## canonical 目标",
    "",
    `核验 ${report.canonical.checked} 个非自指 canonical，抓取目标 ${report.canonical.fetched} 次。`,
    "",
    countTable(report.canonical.ruleCounts),
    "",
    list(report.canonical.findings.filter((f) => f.severity !== "info").map((f) => `${f.rule}：${f.message}`), 30),
    "",
    "## 首个 HTML",
    "",
    `检查 ${report.firstHtml.checked} 页，空壳 ${report.firstHtml.shellPages.length} 页。`,
    "",
    list(report.firstHtml.shellPages, 50),
  ];
  if (report.retraction !== undefined) {
    out.push(
      "",
      "## 撤稿扫描",
      "",
      `扫描 ${report.retraction.checked.pages} 页、${report.retraction.checked.terms} 个词条，命中 ${report.retraction.hits.length} 处。`,
      "",
      list(report.retraction.hits.map((h) => `${h.url}（${h.facet}）：${h.term}`), 50),
    );
  }
  out.push("", "## 建议", "");
  const advice = [...errorRules(report).entries()].filter(([rule]) => rule in ADVICE)
    .map(([rule, n]) => `- **${rule}**（${n}）：${ADVICE[rule]}`);
  out.push(advice.length === 0 ? "没有需要处理的 error 级问题。" : advice.join("\n"));
  out.push("");
  return out.join("\n");
}

export function reportFileStem(origin: string, now: number): string {
  const host = new URL(origin).hostname.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `${host}-${stamp}`;
}

export async function writeSiteReport(report: SiteReport, outDir: string): Promise<WriteReportResult> {
  await mkdir(outDir, { recursive: true });
  const stem = reportFileStem(report.origin, Date.parse(report.generatedAt));
  const jsonPath = join(outDir, `${stem}.json`);
  const markdownPath = join(outDir, `${stem}.md`);
  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  await writeFile(markdownPath, renderSiteReportMarkdown(report));
  return { jsonPath, markdownPath };
}

export function summarizeSiteReport(report: SiteReport, files?: WriteReportResult): Record<string, unknown> {
  const topIssues: Array<{ layer: string; rule: string; evidence?: string }> = [];
  const push = (layer: string, findings: Finding[]) => {
    for (const f of findings) {
      if (f.severity !== "error" || topIssues.length >= 10) return;
      topIssues.push({ layer, rule: f.rule, ...(f.evidence === undefined ? {} : { evidence: f.evidence }) });
    }
  };
  push("robots", report.robots.findings);
  push("discovery", report.discovery.findings);
  push("sitemap", report.sitemap.findings);
  for (const w of report.pageAudit.worst) {
    if (topIssues.length >= 10) break;
    if (w.errors > 0) topIssues.push({ layer: "page-audit", rule: w.rules.join(","), evidence: w.url });
  }
  for (const o of report.serp.overBudget) {
    if (topIssues.length >= 10) break;
    topIssues.push({ layer: "serp", rule: "serp-title-over-budget", evidence: o.url });
  }
  push("canonical", report.canonical.findings);
  for (const url of report.firstHtml.shellPages) {
    if (topIssues.length >= 10) break;
    topIssues.push({ layer: "first-html", rule: "first-html-shell", evidence: url });
  }
  if (report.retraction !== undefined) push("retraction", report.retraction.findings);
  return {
    origin: report.origin,
    generatedAt: report.generatedAt,
    pageCount: report.crawl.pageCount,
    totals: report.totals,
    layers: report.layers,
    topIssues,
    ...(files === undefined ? {} : { files }),
  };
}
