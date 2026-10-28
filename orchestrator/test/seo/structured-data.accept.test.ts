import { describe, expect, test } from "vitest";
import { checkStructuredData, extractJsonLd, runStructuredDataGate } from "../../src/seo/gates/structured-data.js";
import { handleSeoMcp, type JsonRpcRequest, type SeoToolContext } from "../../src/seo/mcp-server.js";
import { builtinSeoTools } from "../../src/seo/tools.js";

const ld = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const page = (...blocks: string[]) => `<html><head><title>t</title>${blocks.join("")}</head><body><h1>t</h1></body></html>`;
const CTX = "https://schema.org";
const rules = (html: string) => checkStructuredData(html).findings.map((f) => `${f.rule}:${f.severity}:${f.evidence ?? ""}`).sort();

describe("extractJsonLd（作者锁定）", () => {
  test("多块、数组、@graph 展开；坏 JSON 记错；type 属性大小写与空白不敏感", () => {
    const html = page(
      ld({ "@context": CTX, "@type": "Organization", name: "A" }),
      ld([{ "@context": CTX, "@type": "WebSite" }, { "@context": CTX, "@type": "WebPage" }]),
      ld({ "@context": CTX, "@graph": [{ "@type": "Product" }, { "@type": ["Article", "NewsArticle"] }] }),
      `<script type=" Application/LD+JSON ">{"@context":"${CTX}","@type":"Event"}</script>`,
      `<script type="application/ld+json">{ not json</script>`,
      `<script type="application/json">{"@type":"Recipe"}</script>`,
    );
    const r = extractJsonLd(html);
    expect(r.blocks).toBe(5);
    expect(r.nodes.map((n) => n.path)).toEqual(["0", "1[0]", "1[1]", "2@graph[0]", "2@graph[1]", "3"]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].block).toBe(4);
    expect(checkStructuredData(html).types).toEqual(["Organization", "WebSite", "WebPage", "Product", "Article", "NewsArticle", "Event"]);
  });
});

describe("checkStructuredData 规则（作者锁定）", () => {
  test("没有 JSON-LD：只报 sd-none，ok", () => {
    const r = checkStructuredData(page());
    expect(r.ok).toBe(true);
    expect(r.blocks).toBe(0);
    expect(rules(page())).toEqual(["sd-none:info:"]);
  });

  test("坏 JSON 与缺 @context", () => {
    expect(rules(page(`<script type="application/ld+json">{ "@type": "Product", oops }</script>`)))
      .toEqual(['sd-json-invalid:error:{ "@type": "Product", oops }']);
    expect(rules(page(ld({ "@type": "Organization", name: "A", url: "https://a.test", logo: "https://a.test/l.png" }))))
      .toEqual(["sd-no-context:warn:"]);
    expect(rules(page(ld({ "@context": "https://example.org", "@type": "Organization", name: "A", url: "u", logo: "l" }))))
      .toEqual(["sd-no-context:warn:"]);
  });

  test("Product：必填、多选一、offers 数组逐项但同字段只报一次、推荐项", () => {
    expect(rules(page(ld({ "@context": CTX, "@type": "Product" })))).toEqual([
      "sd-missing-recommended:warn:Product.description",
      "sd-missing-recommended:warn:Product.image",
      "sd-missing-required:error:Product.name",
      "sd-missing-required:error:Product.offers|review|aggregateRating",
    ]);
    expect(rules(page(ld({
      "@context": CTX, "@type": "Product", name: "Panel", image: "i.png", description: "d",
      offers: [{ "@type": "Offer", price: "199" }, { "@type": "Offer", price: 99 }, { "@type": "Offer" }],
    })))).toEqual([
      "sd-missing-required:error:Product.offers.price",
      "sd-missing-required:error:Product.offers.priceCurrency",
    ]);
    const good = checkStructuredData(page(ld({
      "@context": CTX, "@type": "Product", name: "Panel", image: "i.png", description: "d",
      offers: { "@type": "Offer", price: "199.00", priceCurrency: "EUR" },
    })));
    expect(good.ok).toBe(true);
    expect(good.findings).toEqual([]);
    expect(checkStructuredData(page(ld({ "@context": CTX, "@type": "Product", name: "P", image: "i", description: "d", aggregateRating: { ratingValue: 4.5, reviewCount: 10 } }))).findings).toEqual([]);
  });

  test("Article 族只有推荐项；类型名用节点自己的", () => {
    const html = page(ld({ "@context": CTX, "@type": "BlogPosting", headline: "h", image: [] }));
    const r = checkStructuredData(html);
    expect(r.ok).toBe(true);
    expect(rules(html)).toEqual([
      "sd-missing-recommended:warn:BlogPosting.author",
      "sd-missing-recommended:warn:BlogPosting.datePublished",
      "sd-missing-recommended:warn:BlogPosting.image",
    ]);
  });

  test("FAQPage：受限提示 + 问答字段；HowTo：已下线", () => {
    expect(rules(page(ld({
      "@context": CTX, "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "Q1", acceptedAnswer: { "@type": "Answer", text: "A1" } },
        { "@type": "Question", acceptedAnswer: { "@type": "Answer" } },
      ],
    })))).toEqual([
      "sd-missing-required:error:FAQPage.mainEntity.acceptedAnswer.text",
      "sd-missing-required:error:FAQPage.mainEntity.name",
      "sd-restricted-type:info:FAQPage",
    ]);
    expect(rules(page(ld({ "@context": CTX, "@type": "FAQPage" })))).toEqual([
      "sd-missing-required:error:FAQPage.mainEntity",
      "sd-restricted-type:info:FAQPage",
    ]);
    expect(rules(page(ld({ "@context": CTX, "@type": "HowTo" })))).toEqual(["sd-deprecated-type:warn:HowTo"]);
  });

  test("BreadcrumbList：position 必须是数字，最后一项可以没有 item", () => {
    expect(rules(page(ld({
      "@context": CTX, "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://a.test/" },
        { "@type": "ListItem", position: "2", name: "Guides" },
        { "@type": "ListItem", position: 3 },
      ],
    })))).toEqual([
      "sd-missing-required:error:BreadcrumbList.itemListElement.item",
      "sd-missing-required:error:BreadcrumbList.itemListElement.name",
      "sd-missing-required:error:BreadcrumbList.itemListElement.position",
    ]);
    expect(checkStructuredData(page(ld({
      "@context": CTX, "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://a.test/" },
        { "@type": "ListItem", position: 2, name: "Here" },
      ],
    }))).findings).toEqual([]);
  });

  test("LocalBusiness / Event / Recipe / VideoObject / JobPosting 必填；Organization 推荐；未知类型不查", () => {
    expect(rules(page(ld({ "@context": CTX, "@type": "LocalBusiness", name: "Shop" })))).toEqual(["sd-missing-required:error:LocalBusiness.address"]);
    expect(rules(page(ld({ "@context": CTX, "@type": "Event", name: "E", startDate: "2026-10-01" })))).toEqual(["sd-missing-required:error:Event.location"]);
    expect(rules(page(ld({ "@context": CTX, "@type": "Recipe", name: "R" })))).toEqual(["sd-missing-required:error:Recipe.image"]);
    expect(rules(page(ld({ "@context": CTX, "@type": "VideoObject", name: "V", thumbnailUrl: "t.jpg" })))).toEqual(["sd-missing-required:error:VideoObject.uploadDate"]);
    const job = { "@context": CTX, "@type": "JobPosting", title: "Eng", description: "d", datePosted: "2026-09-01", hiringOrganization: { name: "A" } };
    expect(rules(page(ld(job)))).toEqual(["sd-missing-required:error:JobPosting.jobLocation"]);
    expect(rules(page(ld({ ...job, jobLocationType: "TELECOMMUTE" })))).toEqual([]);
    expect(rules(page(ld({ "@context": CTX, "@type": "Organization", name: "A" })))).toEqual([
      "sd-missing-recommended:warn:Organization.logo",
      "sd-missing-recommended:warn:Organization.url",
    ]);
    expect(rules(page(ld({ "@context": CTX, "@type": "TouristAttraction" })))).toEqual([]);
  });

  test("@graph 成员继承外层 @context；多类型节点逐个类型检查", () => {
    expect(rules(page(ld({ "@context": CTX, "@graph": [{ "@type": "Organization", name: "A", url: "u", logo: "l" }] })))).toEqual([]);
    expect(rules(page(ld({ "@context": CTX, "@type": ["LocalBusiness", "Organization"], name: "A", url: "u", logo: "l" })))).toEqual(["sd-missing-required:error:LocalBusiness.address"]);
  });

  test("runStructuredDataGate：逐页汇总", () => {
    const r = runStructuredDataGate([
      { url: "https://a.test/ok", html: page(ld({ "@context": CTX, "@type": "Organization", name: "A", url: "u", logo: "l" })) },
      { url: "https://a.test/bad", html: page(ld({ "@context": CTX, "@type": "Event" })) },
    ]);
    expect(r.ok).toBe(false);
    expect(r.checked).toBe(2);
    expect(r.pages.map((p) => [p.url, p.ok])).toEqual([["https://a.test/ok", true], ["https://a.test/bad", false]]);
  });
});

describe("seo_structured_data 工具接线（作者锁定）", () => {
  const ORIGIN = "https://sd-demo.test";
  const SITE: Record<string, { status?: number; body?: string }> = {
    "/p": { body: page(ld({ "@context": CTX, "@type": "Product", name: "Panel", image: "i", description: "d", offers: { price: "1", priceCurrency: "EUR" } })) },
    "/e": { body: page(ld({ "@context": CTX, "@type": "Event" })) },
    "/gone": { status: 404 },
  };
  const seen: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    seen.push(`${new Headers(init?.headers).get("user-agent") ?? "-"} ${url.pathname}`);
    if (url.pathname === "/boom") throw new Error("socket hang up");
    const entry = SITE[url.pathname];
    if (!entry) return new Response("nf", { status: 404 });
    return new Response(entry.body ?? "", { status: entry.status ?? 200, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;
  const ctx: SeoToolContext = { repoRoot: "/tmp/demo-repo", fetchImpl, now: () => 1 };
  const tools = builtinSeoTools();

  test("位置、注解、入参", () => {
    const names = tools.map((t) => t.name);
    expect(names.indexOf("seo_structured_data")).toBe(names.indexOf("seo_discovery_check") + 1);
    expect(names.indexOf("seo_serp_budget")).toBe(names.indexOf("seo_structured_data") + 1);
    const tool = tools.find((t) => t.name === "seo_structured_data")!;
    expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
    expect(tool.inputSchema.required).toEqual(["urls"]);
  });

  test("抓取、校验、失败分流", async () => {
    seen.length = 0;
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "seo_structured_data", arguments: { urls: [`${ORIGIN}/p`, `${ORIGIN}/e`, `${ORIGIN}/gone`, `${ORIGIN}/boom`] } } };
    const res = await handleSeoMcp(req, { tools, context: ctx, outputBudgetChars: 200_000 });
    const out = JSON.parse((res!.result as { content: Array<{ text: string }> }).content[0].text);
    expect(out.ok).toBe(false);
    expect(out.checked).toBe(2);
    expect(out.pages.map((p: { url: string; ok: boolean }) => [p.url, p.ok])).toEqual([[`${ORIGIN}/p`, true], [`${ORIGIN}/e`, false]]);
    expect(out.failed).toEqual([{ url: `${ORIGIN}/gone`, status: 404 }, { url: `${ORIGIN}/boom`, status: 0 }]);
    expect(seen.every((s) => s.startsWith("kunpeng-seo/"))).toBe(true);
  });
});