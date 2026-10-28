import { describe, expect, test } from "vitest";
import { runCanonicalTargetGate, titleSimilarity } from "../../src/seo/gates/canonical-target.js";

const ORIGIN = "https://demo-travel.ai";
const canon = (href: string) => `<link rel="canonical" href="${href}">`;
const html = (title: string, head = "") => `<html><head><title>${title}</title>${head}</head><body><h1>x</h1></body></html>`;
const page = (path: string, title: string, head = "") => ({ url: `${ORIGIN}${path}`, html: html(title, head) });

const SITE: Record<string, { status?: number; body?: string; throw?: boolean }> = {
  "/guide": { body: html("Beijing metro guide for foreign visitors", canon(`${ORIGIN}/guide`)) },
  "/unrelated": { body: html("Refund policy and terms", canon(`${ORIGIN}/unrelated`)) },
  "/hidden": { body: html("Beijing metro guide (archived)", `${canon(`${ORIGIN}/hidden`)}<meta name="robots" content="noindex">`) },
  "/hop": { body: html("Beijing metro guide hop", canon(`${ORIGIN}/guide`)) },
  "/gone": { status: 404 },
  "/boom": { throw: true },
};

let calls: string[] = [];
const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  calls.push(`${new Headers(init?.headers).get("user-agent") ?? "-"} ${url.pathname}`);
  if (url.hostname !== "demo-travel.ai") return new Response(html("Partner copy of the metro guide"), { status: 200 });
  const entry = SITE[url.pathname];
  if (entry === undefined) return new Response("nf", { status: 404 });
  if (entry.throw) throw new Error("socket hang up");
  return new Response(entry.body ?? "", { status: entry.status ?? 200, headers: { "content-type": "text/html" } });
}) as unknown as typeof fetch;

describe("canonical 目标核验门(作者锁定)", () => {
  test("titleSimilarity:词级 Jaccard,CJK 无空格按二元组", () => {
    expect(titleSimilarity("Beijing metro guide for visitors", "Beijing metro guide for visitors")).toBe(1);
    expect(titleSimilarity("Beijing metro guide", "Refund policy and terms")).toBe(0);
    expect(titleSimilarity("Beijing metro guide 2026", "Beijing metro guide")).toBeCloseTo(0.75, 2);
    expect(titleSimilarity("北京地铁外国游客指南", "北京地铁外国游客指南")).toBe(1);
    expect(titleSimilarity("北京地铁外国游客指南", "退款政策与条款说明")).toBe(0);
    expect(titleSimilarity("", "x")).toBe(0);
  });

  test("自指与无 canonical 不发请求;错指/断链/noindex/成链各报其名;同目标只抓一次", async () => {
    calls = [];
    const r = await runCanonicalTargetGate([
      page("/guide", "Beijing metro guide for foreign visitors", canon(`${ORIGIN}/guide`)),
      page("/plain", "No canonical at all"),
      page("/guide?utm=x", "Beijing metro guide for foreign visitors", canon("/guide")),
      page("/guide-old", "Beijing metro guide 2024 edition", canon(`${ORIGIN}/guide/`)),
      page("/wrong", "Alipay setup for foreign cards", canon(`${ORIGIN}/unrelated`)),
      page("/dead", "Shanghai taxi fares", canon(`${ORIGIN}/gone`)),
      page("/crash", "Shanghai taxi fares", canon(`${ORIGIN}/boom`)),
      page("/to-hidden", "Beijing metro guide mirror", canon(`${ORIGIN}/hidden`)),
      page("/to-hop", "Beijing metro guide mirror", canon(`${ORIGIN}/hop`)),
      page("/syndicated", "Partner copy of the metro guide", canon("https://partner.example/metro")),
      page("/wrong-but-noindex", "Alipay setup for foreign cards", `${canon(`${ORIGIN}/unrelated`)}<meta name="googlebot" content="noindex">`),
    ], { fetchImpl, userAgent: "ua-test" });

    expect(r.checked).toBe(9);
    expect(r.fetched).toBe(6);
    expect(calls.filter((c) => c.endsWith("/unrelated"))).toHaveLength(1);
    expect(calls.every((c) => c.startsWith("ua-test "))).toBe(true);
    expect(calls.some((c) => c.endsWith(" /guide"))).toBe(false);
    expect(r.pages.map((p) => [p.self, p.canonical])).toEqual([
      [true, `${ORIGIN}/guide`], [false, null], [false, `${ORIGIN}/guide`], [false, `${ORIGIN}/guide`],
      [false, `${ORIGIN}/unrelated`], [false, `${ORIGIN}/gone`], [false, `${ORIGIN}/boom`],
      [false, `${ORIGIN}/hidden`], [false, `${ORIGIN}/hop`], [false, "https://partner.example/metro"],
      [false, `${ORIGIN}/unrelated`],
    ]);
    expect(r.pages[3].target).toMatchObject({ status: 200, chain: false, noindex: false, crossOrigin: false, title: "Beijing metro guide for foreign visitors" });
    expect(r.pages[3].target!.similarity).toBeGreaterThan(0.2);
    expect(r.pages[4].target!.similarity).toBe(0);
    expect(r.pages[6].target).toMatchObject({ status: 0, title: null });
    expect(r.pages[8].target).toMatchObject({ chain: true, canonical: `${ORIGIN}/guide` });
    expect(r.pages[9].target).toMatchObject({ crossOrigin: true, status: 200 });
    expect(r.findings.map((f) => [f.rule, f.severity, f.evidence])).toEqual([
      ["canonical-target-dissimilar", "warn", `${ORIGIN}/unrelated`],
      ["canonical-target-unreachable", "error", `${ORIGIN}/gone`],
      ["canonical-target-unreachable", "error", `${ORIGIN}/boom`],
      ["canonical-target-noindex", "error", `${ORIGIN}/hidden`],
      ["canonical-chain", "error", `${ORIGIN}/guide`],
      ["canonical-cross-origin", "info", "https://partner.example/metro"],
    ]);
    expect(r.findings[0].message).toContain("Alipay setup for foreign cards");
    expect(r.findings[1].message).toContain("404");
    expect(r.findings[4].message).toContain(`${ORIGIN}/hop`);
    expect(r.ok).toBe(false);
  });

  test("全部自指或指向可达、相似、终态的页 → 绿;相似度阈值可调", async () => {
    const pages = [
      page("/guide", "Beijing metro guide for foreign visitors", canon(`${ORIGIN}/guide`)),
      page("/guide-print", "Beijing metro guide for foreign visitors (print)", canon(`${ORIGIN}/guide`)),
    ];
    const green = await runCanonicalTargetGate(pages, { fetchImpl });
    expect(green.ok).toBe(true);
    expect(green.findings).toEqual([]);
    expect(green.checked).toBe(1);
    expect(green.fetched).toBe(0);
    const strict = await runCanonicalTargetGate(pages, { fetchImpl, similarityMin: 0.99 });
    expect(strict.ok).toBe(true);
    expect(strict.findings.map((f) => f.rule)).toEqual(["canonical-target-dissimilar"]);
  });
});