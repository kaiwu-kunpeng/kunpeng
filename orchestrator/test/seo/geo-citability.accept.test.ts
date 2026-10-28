import { describe, expect, test } from "vitest";
import { checkGeoCitability, GEO_RUBRIC_VERSION, runGeoCitabilityGate } from "../../src/seo/gates/geo-citability.js";
import { handleSeoMcp, type JsonRpcRequest, type SeoToolContext } from "../../src/seo/mcp-server.js";
import { builtinSeoTools } from "../../src/seo/tools.js";

const NOW = Date.parse("2026-09-28T00:00:00Z");
const U = "https://geo.test/guide";
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const ld = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;

const RICH = `<!doctype html><html lang="en"><head><title>t</title>
<meta name="author" content="Jane Doe">
${ld({ "@context": "https://schema.org", "@type": "Article", headline: "h", dateModified: "2026-09-01", author: { "@type": "Person", name: "Jane Doe", url: "https://geo.test/jane" } })}
</head><body>
<nav><h2>What is nav?</h2><ul><li>a</li><li>b</li><li>c</li></ul></nav>
<main>
<p>${words(40)}</p>
<h2>How do solar panels work?</h2><h2>Installation</h2><h3>Why choose back contact cells?</h3><h3>Pricing</h3>
<p>Efficiency reached 24.8% in 2026, according to <a href="https://www.nrel.gov/pv/cell-efficiency.html">NREL</a>. ${words(200)}</p>
<blockquote>Back-contact cells remove front grid shading.</blockquote>
<ul><li>one</li><li>two</li><li>three</li></ul>
</main>
<footer><a href="https://other.test/x">x</a></footer>
</body></html>`;

const byId = (r: ReturnType<typeof checkGeoCitability>) => Object.fromEntries(r.checks.map((c) => [c.id, c]));

describe("checkGeoCitability（作者锁定）", () => {
  test("信号齐全的页：各项满分或接近满分", () => {
    const r = checkGeoCitability({ url: U, html: RICH, now: NOW });
    expect(GEO_RUBRIC_VERSION).toBe("kp-geo-v1");
    expect(r.rubric).toBe("kp-geo-v1");
    expect(r.checks.map((c) => c.id)).toEqual([
      "answer-first", "question-headings", "sourced-statistics", "quotations", "freshness",
      "authorship", "server-rendered", "structured-data", "extractable-structure",
    ]);
    const c = byId(r);
    expect(c["answer-first"]).toMatchObject({ points: 9, max: 9, observable: true, evidence: "40" });
    expect(c["question-headings"]).toMatchObject({ points: 7, max: 7, observable: true, evidence: "2/4" });
    expect(c["sourced-statistics"]).toMatchObject({ points: 7, evidence: "stats=yes cite=yes" });
    expect(c["quotations"]).toMatchObject({ points: 4, evidence: "1" });
    expect(c["freshness"]).toMatchObject({ points: 6 });
    expect(c["freshness"].evidence.startsWith("2026-09-01")).toBe(true);
    expect(c["authorship"]).toMatchObject({ points: 6, evidence: "Jane Doe" });
    expect(c["server-rendered"].points).toBe(5);
    expect(c["structured-data"]).toMatchObject({ points: 4, evidence: "Article" });
    expect(c["extractable-structure"].points).toBe(4);
    expect(r.observableMax).toBe(52);
    expect(r.earned).toBe(52);
    expect(r.score).toBe(100);
    expect(r.findings).toEqual([]);
  });

  test("贫瘠的页：低分、没有标题时 question-headings 不进分母", () => {
    const html = `<html><body><div>${words(30)}</div><p>short intro</p><a href="https://elsewhere.test/">x</a></body></html>`;
    const r = checkGeoCitability({ url: U, html, now: NOW });
    const c = byId(r);
    expect(c["question-headings"]).toMatchObject({ points: 0, observable: false, evidence: "0/0" });
    expect(c["answer-first"]).toMatchObject({ points: 0, evidence: "2" });
    expect(c["sourced-statistics"]).toMatchObject({ points: 0, evidence: "stats=no cite=yes" });
    expect(c["server-rendered"]).toMatchObject({ points: 0, evidence: "31" });
    expect(r.observableMax).toBe(45);
    expect(r.earned).toBe(0);
    expect(r.score).toBe(0);
    expect(r.findings.map((f) => f.rule)).not.toContain("geo-question-headings");
    expect(r.findings.every((f) => f.severity === "warn")).toBe(true);
    expect(r.findings).toHaveLength(8);
  });

  test("部分得分与 info 级 finding；过期日期；超长首段；中文问句标题", () => {
    const html = `<html><body><article>
<p>${"光伏组件的效率决定了单位面积的发电量，".repeat(20)}</p>
<h2>如何选择组件？</h2><h2>安装步骤</h2><h2>质保</h2><h2>价格</h2>
<p>转换效率达到 25% 以上。</p>
<time datetime="2024-01-10">2024年1月10日</time>
</article></body></html>`;
    const r = checkGeoCitability({ url: U, html, now: NOW });
    const c = byId(r);
    expect(c["answer-first"].points).toBe(4);
    expect(c["question-headings"]).toMatchObject({ points: 4, evidence: "1/4" });
    expect(c["sourced-statistics"]).toMatchObject({ points: 3, evidence: "stats=yes cite=no" });
    expect(c["freshness"].points).toBe(3);
    const info = r.findings.filter((f) => f.severity === "info").map((f) => f.rule).sort();
    expect(info).toEqual(["geo-answer-first", "geo-freshness", "geo-question-headings", "geo-sourced-statistics"]);
  });

  test("导航、页脚里的外链与列表不算", () => {
    const html = `<html><body><header><ul><li>a</li><li>b</li><li>c</li></ul></header><main><p>${words(30)} grew 40% last year.</p></main><footer><a href="https://cite.test/">src</a></footer></body></html>`;
    const c = byId(checkGeoCitability({ url: U, html, now: NOW }));
    expect(c["sourced-statistics"].evidence).toBe("stats=yes cite=no");
    expect(c["extractable-structure"].points).toBe(0);
  });
});

describe("runGeoCitabilityGate 与工具（作者锁定）", () => {
  test("平均分", () => {
    const r = runGeoCitabilityGate([{ url: U, html: RICH }, { url: `${U}/2`, html: "<html><body><p>x</p></body></html>" }], NOW);
    expect(r.rubric).toBe("kp-geo-v1");
    expect(r.checked).toBe(2);
    expect(r.averageScore).toBe(Math.round((r.pages[0].score + r.pages[1].score) / 2));
    expect(runGeoCitabilityGate([], NOW)).toEqual({ rubric: "kp-geo-v1", checked: 0, averageScore: 0, pages: [] });
  });

  test("工具位置、注解与调用", async () => {
    const tools = builtinSeoTools();
    const names = tools.map((t) => t.name);
    expect(names.indexOf("seo_geo_citability")).toBe(names.indexOf("seo_audit_page") + 1);
    expect(names.indexOf("seo_crawl_site")).toBe(names.indexOf("seo_geo_citability") + 1);
    const tool = tools.find((t) => t.name === "seo_geo_citability")!;
    expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
    expect(tool.inputSchema).toEqual({ type: "object", properties: { urls: { type: "array", items: { type: "string" } } }, required: ["urls"], additionalProperties: false });
    const fetchImpl = (async (input: string | URL | Request) => {
      const p = new URL(String(input)).pathname;
      if (p === "/boom") throw new Error("socket hang up");
      if (p === "/guide") return new Response(RICH, { status: 200, headers: { "content-type": "text/html" } });
      return new Response("nf", { status: 404 });
    }) as unknown as typeof fetch;
    const ctx: SeoToolContext = { repoRoot: "/tmp/demo-repo", fetchImpl, now: () => NOW };
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "seo_geo_citability", arguments: { urls: [U, "https://geo.test/missing", "https://geo.test/boom"] } } };
    const res = await handleSeoMcp(req, { tools, context: ctx, outputBudgetChars: 200_000 });
    const out = JSON.parse((res!.result as { content: Array<{ text: string }> }).content[0].text);
    expect(out.checked).toBe(1);
    expect(out.averageScore).toBe(100);
    expect(out.failed).toEqual([{ url: "https://geo.test/missing", status: 404 }, { url: "https://geo.test/boom", status: 0 }]);
  });
});