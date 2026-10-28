import { describe, expect, test, vi } from "vitest";
import { PAGE_FACETS, fetchRetractionSweep, findTerm, runRetractionSweep, sweepHtml, sweepText } from "../../src/seo/gates/retraction-sweep.js";

const ORIGIN = "https://demo-travel.ai";
const CLAIM = "129 official ticket sites";
const OTHER = "zero-fee airport SIM";

const CLEAN = `<html lang="en"><head><title>Ticket sites for foreign visitors</title>
<meta name="description" content="How passport checks work at attraction ticket counters.">
<meta property="og:description" content="Passport checks at ticket counters.">
<script type="application/ld+json">{"@type":"Article","headline":"Ticket sites for foreign visitors"}</script>
</head><body><h1>Ticket sites</h1><p>We checked the reachability of official ticket sites across five cities.</p></body></html>`;

const DIRTY = `<html lang="en"><head><title>We tested ${CLAIM} for you</title>
<meta name="description" content="Clean description without the number.">
<meta property="og:title" content="Ticket sites">
<meta name="twitter:description" content="A dataset of ${CLAIM.toUpperCase()} in China.">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Article","abstract":"Built from ${CLAIM}."},{"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How many?","acceptedAnswer":{"@type":"Answer","text":"We verified ${CLAIM} last month."}}]}]}</script>
<script type="application/ld+json">{not json</script>
</head><body><div id="__next"><h1>Ticket sites</h1><p>Visible copy still says   ${CLAIM}   today.</p>
<div itemscope itemtype="https://schema.org/Question"><span itemprop="acceptedAnswer">Answer markup: ${OTHER}.</span></div>
<script>console.log("${CLAIM} in a script must not count as visible")</script></div></body></html>`;

describe("D4 撤稿七面扫描(作者锁定)", () => {
  test("findTerm:不分大小写、折叠空白、片段以命中为中心", () => {
    expect(findTerm("Nothing here", CLAIM)).toBeNull();
    const snippet = findTerm(`aaa   bbb ${CLAIM.toUpperCase()} ccc`, "  129 official  ticket sites ")!;
    expect(snippet).toContain("129 OFFICIAL TICKET SITES");
    expect(snippet.length).toBeLessThanOrEqual(CLAIM.length + 80);
    expect(snippet.startsWith("aaa bbb ")).toBe(true);
  });

  test("干净页:七面全 0", () => {
    expect(sweepHtml(CLEAN, `${ORIGIN}/tickets`, [CLAIM, OTHER])).toEqual([]);
    expect([...PAGE_FACETS]).toEqual(["visible", "title-description", "json-ld", "faq", "social-meta"]);
  });

  test("脏页:每一面都抓得出来,顺序按面再按词,同面同词只一条", () => {
    const hits = sweepHtml(DIRTY, `${ORIGIN}/tickets`, [CLAIM, OTHER]);
    expect(hits.map((h) => `${h.facet}:${h.term}`)).toEqual([
      `visible:${CLAIM}`,
      `visible:${OTHER}`,
      `title-description:${CLAIM}`,
      `json-ld:${CLAIM}`,
      `faq:${CLAIM}`,
      `faq:${OTHER}`,
      `social-meta:${CLAIM}`,
    ]);
    expect(hits[0].url).toBe(`${ORIGIN}/tickets`);
    expect(hits[0].snippet).toContain("Visible copy still says 129 official ticket sites today");
    expect(hits[0].snippet).not.toContain("must not count");
    expect(hits.find((h) => h.facet === "faq" && h.term === CLAIM)!.snippet).toContain("We verified 129 official ticket sites last month");
    expect(hits.find((h) => h.facet === "faq" && h.term === OTHER)!.snippet).toContain("Answer markup");
    expect(hits.find((h) => h.facet === "social-meta")!.snippet).toContain("A dataset of 129 OFFICIAL TICKET SITES");
  });

  test("发现文件:discovery 面", () => {
    const hits = sweepText(`# demo-travel.ai\n- [Tickets](/tickets): we checked ${CLAIM}\n`, `${ORIGIN}/llms.txt`, [CLAIM, OTHER]);
    expect(hits).toEqual([{ url: `${ORIGIN}/llms.txt`, facet: "discovery", term: CLAIM, snippet: expect.stringContaining("we checked 129 official ticket sites") }]);
  });

  test("runRetractionSweep:命中即红,每命中一条 error;空词表红;全净绿", () => {
    const red = runRetractionSweep({
      pages: [{ url: `${ORIGIN}/tickets`, html: DIRTY }, { url: `${ORIGIN}/clean`, html: CLEAN }],
      discovery: [{ url: `${ORIGIN}/llms.txt`, text: `dataset: ${CLAIM}` }],
      terms: [CLAIM, ` ${CLAIM} `, "", OTHER],
    });
    expect(red.ok).toBe(false);
    expect(red.checked).toEqual({ pages: 2, discovery: 1, terms: 2 });
    expect(red.hits).toHaveLength(8);
    expect(red.findings).toHaveLength(8);
    expect(red.findings.every((f) => f.rule === "retraction-hit" && f.severity === "error")).toBe(true);
    expect(red.findings[0].message).toContain(`${ORIGIN}/tickets`);
    expect(red.findings[0].message).toContain("visible");
    expect(red.findings[0].message).toContain(CLAIM);
    expect(red.findings.at(-1)!.message).toContain("llms.txt");

    const empty = runRetractionSweep({ pages: [{ url: `${ORIGIN}/clean`, html: CLEAN }], terms: [" ", ""] });
    expect(empty.ok).toBe(false);
    expect(empty.findings).toEqual([{ rule: "retraction-terms-empty", severity: "error", message: expect.any(String) }]);

    const green = runRetractionSweep({ pages: [{ url: `${ORIGIN}/clean`, html: CLEAN }], discovery: [{ url: `${ORIGIN}/robots.txt`, text: "User-agent: *\nAllow: /" }], terms: [CLAIM] });
    expect(green.ok).toBe(true);
    expect(green.hits).toEqual([]);
    expect(green.findings).toEqual([]);
  });

  test("fetchRetractionSweep:逐 URL 抓取;抓不到的页算未验证也红", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(new Headers(init?.headers).get("user-agent")).toBe("DemoBot/2");
      if (url.pathname === "/tickets") return new Response(DIRTY, { status: 200, headers: { "content-type": "text/html" } });
      if (url.pathname === "/clean") return new Response(CLEAN, { status: 200, headers: { "content-type": "text/html" } });
      if (url.pathname === "/llms.txt") return new Response("no claims here", { status: 200, headers: { "content-type": "text/plain" } });
      if (url.pathname === "/boom") throw new Error("socket hang up");
      return new Response("", { status: 404 });
    });
    const f = fetchImpl as unknown as typeof fetch;
    const r = await fetchRetractionSweep({ urls: [`${ORIGIN}/tickets`, `${ORIGIN}/clean`, `${ORIGIN}/gone`, `${ORIGIN}/boom`], discoveryUrls: [`${ORIGIN}/llms.txt`], terms: [CLAIM], fetchImpl: f, userAgent: "DemoBot/2" });
    expect(r.ok).toBe(false);
    expect(r.checked).toEqual({ pages: 2, discovery: 1, terms: 1 });
    expect(r.failed).toEqual([{ url: `${ORIGIN}/gone`, status: 404 }, { url: `${ORIGIN}/boom`, status: 0 }]);
    expect(r.hits.map((h) => h.facet)).toEqual(["visible", "title-description", "json-ld", "faq", "social-meta"]);
    expect(r.findings.slice(-2).map((x) => [x.rule, x.evidence])).toEqual([
      ["retraction-unverified", `${ORIGIN}/gone`],
      ["retraction-unverified", `${ORIGIN}/boom`],
    ]);
    expect(r.findings.at(-2)!.message).toContain("404");

    const green = await fetchRetractionSweep({ urls: [`${ORIGIN}/clean`], discoveryUrls: [`${ORIGIN}/llms.txt`], terms: [CLAIM], fetchImpl: f, userAgent: "DemoBot/2" });
    expect(green.ok).toBe(true);
    expect(green.failed).toEqual([]);
    expect(green.findings).toEqual([]);
  });
});