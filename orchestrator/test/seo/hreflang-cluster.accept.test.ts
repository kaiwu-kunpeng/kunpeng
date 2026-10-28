import { describe, expect, test } from "vitest";
import { checkHreflangCluster, extractHreflangLinks, isValidHreflang, runHreflangCluster } from "../../src/seo/gates/hreflang-cluster.js";
import { handleSeoMcp, type JsonRpcRequest, type SeoToolContext } from "../../src/seo/mcp-server.js";
import { builtinSeoTools } from "../../src/seo/tools.js";

const O = "https://hl.test";
const alt = (lang: string, href: string) => `<link rel="alternate" hreflang="${lang}" href="${href}">`;
const doc = (lang: string, links: string[], canonical?: string) =>
  `<html lang="${lang}"><head><title>t</title>${canonical ? `<link rel="canonical" href="${canonical}">` : ""}${links.join("")}</head><body>x</body></html>`;
const ev = (r: { findings: Array<{ rule: string; severity: string; evidence?: string }> }) =>
  r.findings.map((f) => `${f.rule}:${f.severity}:${f.evidence}`).sort();

describe("isValidHreflang（作者锁定）", () => {
  test("合法", () => {
    for (const c of ["en", "EN", "en-GB", "en-gb", "zh-Hans", "zh-Hant-TW", "pt-BR", "es-MX", "fil", "x-default", "X-Default", "ja"]) {
      expect(isValidHreflang(c), c).toBe(true);
    }
  });
  test("不合法", () => {
    for (const c of ["jp", "cn", "en-UK", "en_US", "es-419", "en-EU", "xx", "en-GB-foo", "", "en-", "zh-Hans-Abcd", "en-Abcd", "sr-Qaaa", "e", "english"]) {
      expect(isValidHreflang(c), c).toBe(false);
    }
  });
});

describe("extractHreflangLinks（作者锁定）", () => {
  test("相对地址解析并归一；rel 可含多个值", () => {
    const html = `<head><link rel="alternate" hreflang="de" href="/de/"><link rel="alternate nofollow" hreflang="fr" href="${O}/fr/#x"><link rel="alternate" href="/no-lang"></head>`;
    expect(extractHreflangLinks(html, `${O}/en/`)).toEqual([{ lang: "de", href: `${O}/de` }, { lang: "fr", href: `${O}/fr` }]);
  });
});

describe("checkHreflangCluster（作者锁定）", () => {
  const cluster = [alt("en", `${O}/en`), alt("de", `${O}/de`), alt("x-default", `${O}/en`)];
  test("完整互指的集合：ok，无 finding", () => {
    const r = checkHreflangCluster({
      seeds: [`${O}/en/`],
      pages: {
        [`${O}/en`]: { status: 200, html: doc("en", cluster, `${O}/en`) },
        [`${O}/de`]: { status: 200, html: doc("de-DE", cluster, `${O}/de/`) },
      },
    });
    expect(r.ok).toBe(true);
    expect(r.checkedPages).toBe(1);
    expect(r.findings).toEqual([]);
  });

  test("各类错误逐一报出，同 evidence 不重复", () => {
    const seed = `${O}/en`;
    const r = checkHreflangCluster({
      seeds: [seed],
      pages: {
        [seed]: { status: 200, html: doc("en", [
          alt("en", seed), alt("en-UK", `${O}/uk`), alt("jp", `${O}/ja`), alt("jp", `${O}/ja`),
          alt("de", `${O}/de`), alt("de", `${O}/de-2`),
          alt("fr", `${O}/fr`), alt("es", `${O}/es`), alt("it", `${O}/it`), alt("ko", `${O}/ko`), alt("pt", `${O}/pt`),
        ]) },
        [`${O}/uk`]: { status: 200, html: doc("en", [alt("en", seed)]) },
        [`${O}/ja`]: { status: 200, html: doc("ja", [alt("en", seed)]) },
        [`${O}/de`]: { status: 200, html: doc("de", [alt("en", seed)]) },
        [`${O}/de-2`]: { status: 200, html: doc("de", [alt("en", seed)]) },
        [`${O}/fr`]: { status: 301, location: `${O}/fr/home` },
        [`${O}/es`]: { status: 404 },
        [`${O}/it`]: { status: 200, html: doc("it", [alt("en", seed)], `${O}/`) },
        [`${O}/ko`]: { status: 200, html: doc("ko", [alt("ko", `${O}/ko`)]) },
        [`${O}/pt`]: { status: 200, html: doc("zh-CN", [alt("en", seed)]) },
      },
    });
    expect(r.ok).toBe(false);
    expect(ev(r)).toEqual([
      `hreflang-duplicate-code:error:${seed} de`,
      `hreflang-invalid-code:error:${seed} en-UK`,
      `hreflang-invalid-code:error:${seed} jp`,
      `hreflang-lang-mismatch:warn:${seed} -> ${O}/pt`,
      `hreflang-no-return:error:${seed} -> ${O}/ko`,
      `hreflang-target-canonical:error:${seed} -> ${O}/it`,
      `hreflang-target-redirect:error:${seed} -> ${O}/fr`,
      `hreflang-target-status:error:${seed} -> ${O}/es`,
    ].sort());
  });

  test("目标不在 pages 里就跳过；seed 本身非 200 不检查", () => {
    const r = checkHreflangCluster({
      seeds: [`${O}/a`, `${O}/b`],
      pages: { [`${O}/a`]: { status: 200, html: doc("en", [alt("de", `${O}/unknown`)]) }, [`${O}/b`]: { status: 500 } },
    });
    expect(r.ok).toBe(true);
    expect(r.checkedPages).toBe(1);
  });
});

describe("runHreflangCluster 与工具接线（作者锁定）", () => {
  const cluster = [alt("en", `${O}/en`), alt("de", `${O}/de`), alt("fr", `${O}/fr`)];
  const SITE: Record<string, { status: number; body?: string; location?: string }> = {
    "/en": { status: 200, body: doc("en", cluster) },
    "/de": { status: 200, body: doc("de", cluster) },
    "/fr": { status: 302, location: "/fr/" },
  };
  const calls: Array<{ path: string; redirect?: string; ua: string | null }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input));
    calls.push({ path: u.pathname, redirect: init?.redirect, ua: new Headers(init?.headers).get("user-agent") });
    const e = SITE[u.pathname];
    if (!e) return new Response("nf", { status: 404 });
    return new Response(e.body ?? "", { status: e.status, headers: e.location ? { location: e.location } : { "content-type": "text/html" } });
  }) as unknown as typeof fetch;

  test("每个 URL 只抓一次、不跟随跳转、maxTargets 生效", async () => {
    calls.length = 0;
    const r = await runHreflangCluster({ urls: [`${O}/en`], fetchImpl });
    expect(calls.map((c) => c.path)).toEqual(["/en", "/de", "/fr"]);
    expect(calls.every((c) => c.redirect === "manual")).toBe(true);
    expect(r.fetched).toBe(3);
    expect(ev(r)).toEqual([`hreflang-target-redirect:error:${O}/en -> ${O}/fr`]);
    calls.length = 0;
    const capped = await runHreflangCluster({ urls: [`${O}/en`], fetchImpl, maxTargets: 1 });
    expect(calls.map((c) => c.path)).toEqual(["/en", "/de"]);
    expect(capped.fetched).toBe(2);
  });

  test("maxTargets 默认 200", async () => {
    const many = Array.from({ length: 205 }, (_, i) => alt(`x${i}`, `${O}/t${i}`)).join("");
    let n = 0;
    const counting = (async (input: string | URL | Request) => {
      n++;
      const p = new URL(String(input)).pathname;
      return new Response(p === "/hub" ? doc("en", [many]) : doc("en", []), { status: 200, headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;
    const r = await runHreflangCluster({ urls: [`${O}/hub`], fetchImpl: counting });
    expect(r.fetched).toBe(201);
    expect(n).toBe(201);
  });

  test("工具位置、注解与调用", async () => {
    const tools = builtinSeoTools();
    const names = tools.map((t) => t.name);
    expect(names.indexOf("seo_hreflang_cluster")).toBe(names.indexOf("seo_retraction_sweep") + 1);
    expect(names.indexOf("seo_discovery_check")).toBe(names.indexOf("seo_hreflang_cluster") + 1);
    const tool = tools.find((t) => t.name === "seo_hreflang_cluster")!;
    expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
    expect(tool.inputSchema.required).toEqual(["urls"]);
    calls.length = 0;
    const ctx: SeoToolContext = { repoRoot: "/tmp/demo-repo", fetchImpl, now: () => 1 };
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "seo_hreflang_cluster", arguments: { urls: [`${O}/en`] } } };
    const res = await handleSeoMcp(req, { tools, context: ctx, outputBudgetChars: 200_000 });
    const out = JSON.parse((res!.result as { content: Array<{ text: string }> }).content[0].text);
    expect(out.ok).toBe(false);
    expect(out.fetched).toBe(3);
    expect(calls.every((c) => (c.ua ?? "").startsWith("kunpeng-seo/"))).toBe(true);
  });
});