import { describe, expect, test } from "vitest";
import { GscClient, readGscAuth } from "../../src/seo/gsc.js";
import { handleSeoMcp, type JsonRpcRequest, type SeoToolContext } from "../../src/seo/mcp-server.js";
import { builtinSeoTools } from "../../src/seo/tools.js";

const ADC = JSON.stringify({ type: "authorized_user", client_id: "cid", client_secret: "csec", refresh_token: "rtok", quota_project_id: "proj-1" });

describe("readGscAuth（作者锁定）", () => {
  const files = (map: Record<string, string>) => (p: string) => map[p];
  test("默认路径、配额项目、环境变量覆盖", () => {
    expect(readGscAuth({ env: {}, home: "/h", readFile: files({ "/h/.config/gcloud/application_default_credentials.json": ADC }) }))
      .toEqual({ refreshToken: "rtok", clientId: "cid", clientSecret: "csec", quotaProject: "proj-1" });
    expect(readGscAuth({ env: { GOOGLE_APPLICATION_CREDENTIALS: "/x.json", GSC_QUOTA_PROJECT: "proj-2" }, home: "/h", readFile: files({ "/x.json": ADC }) }))
      .toEqual({ refreshToken: "rtok", clientId: "cid", clientSecret: "csec", quotaProject: "proj-2" });
    const noQuota = JSON.stringify({ type: "authorized_user", client_id: "c", client_secret: "s", refresh_token: "r" });
    expect(readGscAuth({ env: {}, home: "/h", readFile: files({ "/h/.config/gcloud/application_default_credentials.json": noQuota }) }))
      .toEqual({ refreshToken: "r", clientId: "c", clientSecret: "s" });
  });
  test("错误分支逐字", () => {
    expect(readGscAuth({ env: {}, home: "/h", readFile: () => undefined }))
      .toEqual({ error: "未找到 Google 默认凭据：/h/.config/gcloud/application_default_credentials.json" });
    expect(readGscAuth({ env: { GOOGLE_APPLICATION_CREDENTIALS: "/x.json" }, home: "/h", readFile: () => "{oops" }))
      .toEqual({ error: "Google 默认凭据不是合法 JSON：/x.json" });
    expect(readGscAuth({ env: {}, home: "/h", readFile: () => JSON.stringify({ type: "service_account" }) }))
      .toEqual({ error: "仅支持 authorized_user 类型的默认凭据" });
    expect(readGscAuth({ env: {}, home: "/h", readFile: () => JSON.stringify({ type: "authorized_user", client_id: "c" }) }))
      .toEqual({ error: "默认凭据缺少 refresh_token/client_id/client_secret" });
  });
});

type Req = { url: string; method: string; headers: Headers; body: string };
function fakeGoogle(opts: { failInspect?: string } = {}) {
  const reqs: Req[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const r: Req = { url, method: init?.method ?? "GET", headers: new Headers(init?.headers), body: String(init?.body ?? "") };
    reqs.push(r);
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
    if (url === "https://oauth2.googleapis.com/token") return json({ access_token: "at-" + reqs.length, expires_in: 3600 });
    if (url === "https://www.googleapis.com/webmasters/v3/sites") return json({ siteEntry: [{ siteUrl: "sc-domain:zeta.test", permissionLevel: "siteOwner" }, { siteUrl: "sc-domain:acme.test", permissionLevel: "siteFullUser" }] });
    if (url.includes("/searchAnalytics/query")) return json({ rows: [{ keys: ["solar panel"], clicks: 3, impressions: 120, ctr: 0.025, position: 7.5 }, { clicks: 1, impressions: 9, ctr: 0.11, position: 3 }] });
    if (url === "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect") {
      const b = JSON.parse(r.body) as { inspectionUrl: string };
      if (b.inspectionUrl === opts.failInspect) return json({ error: { message: "quota" } }, 429);
      if (b.inspectionUrl.endsWith("/new")) return json({ inspectionResult: { indexStatusResult: { verdict: "NEUTRAL", coverageState: "URL is unknown to Google" } } });
      return json({ inspectionResult: { indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed", indexingState: "INDEXING_ALLOWED", robotsTxtState: "ALLOWED", pageFetchState: "SUCCESSFUL", lastCrawlTime: "2026-09-20T01:02:03Z", googleCanonical: b.inspectionUrl, userCanonical: b.inspectionUrl } } });
    }
    return json({ error: "nf" }, 404);
  }) as unknown as typeof fetch;
  return { reqs, fetchImpl };
}
const AUTH = { refreshToken: "rtok", clientId: "cid", clientSecret: "csec", quotaProject: "proj-1" };

describe("GscClient（作者锁定）", () => {
  test("换令牌、缓存令牌、请求头、列站点排序", async () => {
    const g = fakeGoogle();
    let t = 1_000_000;
    const c = new GscClient(AUTH, g.fetchImpl, () => t);
    expect(await c.listSites()).toEqual([
      { siteUrl: "sc-domain:acme.test", permissionLevel: "siteFullUser" },
      { siteUrl: "sc-domain:zeta.test", permissionLevel: "siteOwner" },
    ]);
    await c.listSites();
    const tokenReqs = g.reqs.filter((r) => r.url === "https://oauth2.googleapis.com/token");
    expect(tokenReqs).toHaveLength(1);
    expect(tokenReqs[0].method).toBe("POST");
    expect(tokenReqs[0].headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(tokenReqs[0].body))).toEqual({ grant_type: "refresh_token", refresh_token: "rtok", client_id: "cid", client_secret: "csec" });
    const api = g.reqs.filter((r) => r.url.startsWith("https://www.googleapis.com/"));
    expect(api.every((r) => r.headers.get("authorization") === "Bearer at-1")).toBe(true);
    expect(api.every((r) => r.headers.get("x-goog-user-project") === "proj-1")).toBe(true);
    t += 3600_000;
    await c.listSites();
    expect(g.reqs.filter((r) => r.url === "https://oauth2.googleapis.com/token")).toHaveLength(2);
  });

  test("没有配额项目时不带 x-goog-user-project；非 2xx 抛错", async () => {
    const g = fakeGoogle({ failInspect: "https://acme.test/x" });
    const c = new GscClient({ refreshToken: "r", clientId: "c", clientSecret: "s" }, g.fetchImpl, () => 0);
    await c.listSites();
    expect(g.reqs.filter((r) => r.url.startsWith("https://www.googleapis.com/")).every((r) => r.headers.get("x-goog-user-project") === null)).toBe(true);
    await expect(c.inspect("sc-domain:acme.test", "https://acme.test/x")).rejects.toThrow(/^GSC 429: /);
  });

  test("searchAnalytics 与 inspect 的地址、body 与字段映射", async () => {
    const g = fakeGoogle();
    const c = new GscClient(AUTH, g.fetchImpl, () => 0);
    const rows = await c.searchAnalytics("sc-domain:acme.test", { startDate: "2026-09-01", endDate: "2026-09-25", dimensions: ["query"] });
    expect(rows).toEqual([
      { keys: ["solar panel"], clicks: 3, impressions: 120, ctr: 0.025, position: 7.5 },
      { keys: [], clicks: 1, impressions: 9, ctr: 0.11, position: 3 },
    ]);
    const q = g.reqs.find((r) => r.url.includes("/searchAnalytics/query"))!;
    expect(q.url).toBe("https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aacme.test/searchAnalytics/query");
    expect(JSON.parse(q.body)).toEqual({ startDate: "2026-09-01", endDate: "2026-09-25", dimensions: ["query"] });
    expect(await c.inspect("sc-domain:acme.test", "https://acme.test/new")).toEqual({
      url: "https://acme.test/new", verdict: "NEUTRAL", coverageState: "URL is unknown to Google", indexingState: null,
      robotsTxtState: null, pageFetchState: null, lastCrawlTime: null, googleCanonical: null, userCanonical: null,
    });
    const i = g.reqs.find((r) => r.url.includes("urlInspection"))!;
    expect(i.method).toBe("POST");
    expect(JSON.parse(i.body)).toEqual({ inspectionUrl: "https://acme.test/new", siteUrl: "sc-domain:acme.test" });
  });
});

describe("三个 GSC 工具（作者锁定）", () => {
  const tools = builtinSeoTools();
  const NOW = Date.parse("2026-09-28T12:00:00Z");
  const call = async (context: SeoToolContext, name: string, args: Record<string, unknown>) => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } };
    const res = await handleSeoMcp(req, { tools, context, outputBudgetChars: 500_000 });
    return JSON.parse((res!.result as { content: Array<{ text: string }> }).content[0].text);
  };
  const withClient = (g: ReturnType<typeof fakeGoogle>): SeoToolContext =>
    ({ repoRoot: "/tmp/demo-repo", fetchImpl: g.fetchImpl, now: () => NOW, gscClient: new GscClient(AUTH, g.fetchImpl, () => NOW) });

  test("位置、注解、入参 schema", () => {
    const names = tools.map((t) => t.name);
    const i = names.indexOf("seo_internal_links");
    expect(names.slice(i, i + 5)).toEqual(["seo_internal_links", "seo_gsc_sites", "seo_gsc_query", "seo_gsc_inspect", "seo_sitemap_gate"]);
    const by = (n: string) => tools.find((t) => t.name === n)!;
    for (const n of ["seo_gsc_sites", "seo_gsc_query", "seo_gsc_inspect"]) {
      expect(by(n).annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
    }
    expect(by("seo_gsc_sites").inputSchema).toEqual({ type: "object", properties: {}, additionalProperties: false });
    expect(by("seo_gsc_query").inputSchema).toEqual({
      type: "object",
      properties: {
        siteUrl: { type: "string" }, startDate: { type: "string" }, endDate: { type: "string" },
        dimensions: { type: "array", items: { type: "string" } }, rowLimit: { type: "number" },
        query: { type: "string" }, page: { type: "string" },
      },
      required: ["siteUrl"], additionalProperties: false,
    });
    expect(by("seo_gsc_inspect").inputSchema).toEqual({
      type: "object",
      properties: { siteUrl: { type: "string" }, urls: { type: "array", items: { type: "string" } } },
      required: ["siteUrl", "urls"], additionalProperties: false,
    });
  });

  test("seo_gsc_sites", async () => {
    const out = await call(withClient(fakeGoogle()), "seo_gsc_sites", {});
    expect(out).toEqual({ ok: true, sites: [
      { siteUrl: "sc-domain:acme.test", permissionLevel: "siteFullUser" },
      { siteUrl: "sc-domain:zeta.test", permissionLevel: "siteOwner" },
    ] });
  });

  test("seo_gsc_query：默认日期、维度白名单、rowLimit 夹紧、过滤器", async () => {
    const g = fakeGoogle();
    const out = await call(withClient(g), "seo_gsc_query", { siteUrl: "sc-domain:acme.test", dimensions: ["query", "bogus", "page"], rowLimit: 99999, query: "solar", page: "/cn/" });
    expect(out.ok).toBe(true);
    expect(out.startDate).toBe("2026-08-29");
    expect(out.endDate).toBe("2026-09-25");
    expect(out.dimensions).toEqual(["query", "page"]);
    expect(out.rows).toHaveLength(2);
    const body = JSON.parse(g.reqs.find((r) => r.url.includes("/searchAnalytics/query"))!.body);
    expect(body).toEqual({
      startDate: "2026-08-29", endDate: "2026-09-25", dimensions: ["query", "page"], rowLimit: 25000,
      dimensionFilterGroups: [{ filters: [
        { dimension: "query", operator: "contains", expression: "solar" },
        { dimension: "page", operator: "contains", expression: "/cn/" },
      ] }],
    });
    const g2 = fakeGoogle();
    await call(withClient(g2), "seo_gsc_query", { siteUrl: "sc-domain:acme.test", startDate: "2026-09-01", endDate: "2026-09-02", rowLimit: 0 });
    const body2 = JSON.parse(g2.reqs.find((r) => r.url.includes("/searchAnalytics/query"))!.body);
    expect(body2).toEqual({ startDate: "2026-09-01", endDate: "2026-09-02", dimensions: [], rowLimit: 1 });
  });

  test("seo_gsc_inspect：前 50 个、串行、单个失败不中断、按覆盖状态计数", async () => {
    const g = fakeGoogle({ failInspect: "https://acme.test/bad" });
    const urls = ["https://acme.test/a", "https://acme.test/new", "https://acme.test/bad", ...Array.from({ length: 60 }, (_, k) => `https://acme.test/p${k}`)];
    const out = await call(withClient(g), "seo_gsc_inspect", { siteUrl: "sc-domain:acme.test", urls });
    expect(out.ok).toBe(true);
    expect(out.checked).toBe(50);
    expect(out.results).toHaveLength(49);
    expect(out.errors).toEqual([{ url: "https://acme.test/bad", error: expect.stringMatching(/^GSC 429: /) }]);
    expect(out.coverage).toEqual({ "Submitted and indexed": 48, "URL is unknown to Google": 1 });
    const order = g.reqs.filter((r) => r.url.includes("urlInspection")).map((r) => JSON.parse(r.body).inspectionUrl);
    expect(order).toEqual(urls.slice(0, 50));
  });

  test("没有凭据时明确报错、不抛异常", async () => {
    const ctx: SeoToolContext = { repoRoot: "/tmp/demo-repo", fetchImpl: fakeGoogle().fetchImpl, now: () => NOW,
      gscClient: { listSites: async () => { throw new Error("GSC 401: expired"); }, searchAnalytics: async () => [], inspect: async () => { throw new Error("x"); } } };
    expect(await call(ctx, "seo_gsc_sites", {})).toEqual({ ok: false, error: "GSC 401: expired" });
  });
});