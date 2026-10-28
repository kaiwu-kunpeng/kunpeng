import { describe, expect, test, vi } from "vitest";
import {
  AI_BOT_CLASSES,
  effectiveGroup,
  fetchRobotsGate,
  parseRobotsGroups,
  runRobotsGate,
  verdictFor,
} from "../../src/seo/gates/robots-classes.js";

const HEALTHY = `# demo-travel.ai robots
User-Agent: *
Allow: /
Allow: /llms.txt

User-Agent: Googlebot
User-Agent: Bingbot
User-Agent: GPTBot
User-Agent: ChatGPT-User
User-Agent: OAI-SearchBot
User-Agent: ClaudeBot
User-Agent: Claude-SearchBot
User-Agent: Claude-User
User-Agent: PerplexityBot
User-Agent: Perplexity-User
User-Agent: GoogleOther
Allow: /
Disallow: /admin/

Host: https://demo-travel.ai
Sitemap: https://demo-travel.ai/sitemap.xml
`;

describe("D9 robots 三态门(作者锁定)", () => {
  test("词典:21 条,三类各 9/8/4,名字唯一", () => {
    expect(AI_BOT_CLASSES).toHaveLength(21);
    expect(AI_BOT_CLASSES.filter((b) => b.class === "training").map((b) => b.agent)).toEqual([
      "GPTBot", "ClaudeBot", "anthropic-ai", "Google-Extended", "CCBot", "Bytespider", "Applebot-Extended", "meta-externalagent", "Amazonbot",
    ]);
    expect(AI_BOT_CLASSES.filter((b) => b.class === "search").map((b) => b.agent)).toEqual([
      "Googlebot", "Bingbot", "OAI-SearchBot", "Claude-SearchBot", "PerplexityBot", "Applebot", "DuckDuckBot", "YandexBot",
    ]);
    expect(AI_BOT_CLASSES.filter((b) => b.class === "user").map((b) => b.agent)).toEqual([
      "ChatGPT-User", "Claude-User", "Perplexity-User", "meta-externalfetcher",
    ]);
    expect(new Set(AI_BOT_CLASSES.map((b) => b.agent.toLowerCase())).size).toBe(21);
  });

  test("parseRobotsGroups:连续 UA 成组、字段不分大小写、空 Disallow 等于允许、Sitemap/Host", () => {
    const p = parseRobotsGroups(HEALTHY);
    expect(p.groups).toHaveLength(2);
    expect(p.groups[0]).toEqual({ agents: ["*"], rules: [{ type: "allow", path: "/" }, { type: "allow", path: "/llms.txt" }] });
    expect(p.groups[1].agents).toHaveLength(11);
    expect(p.groups[1].rules).toEqual([{ type: "allow", path: "/" }, { type: "disallow", path: "/admin/" }]);
    expect(p.sitemaps).toEqual(["https://demo-travel.ai/sitemap.xml"]);
    expect(p.host).toBe("https://demo-travel.ai");
    expect(parseRobotsGroups("user-agent: *\ndisallow:\n").groups[0].rules).toEqual([{ type: "allow", path: "/" }]);
    expect(parseRobotsGroups("Disallow: /\n").groups).toEqual([]);
  });

  test("effectiveGroup / verdictFor:最长 UA token 胜,最长路径胜,等长 Allow 胜,部分封禁为 partial", () => {
    const p = parseRobotsGroups(`User-agent: *\nDisallow: /private\n\nUser-agent: Googlebot\nDisallow: /\nAllow: /\n\nUser-agent: Googlebot-Image\nDisallow: /\n\nUser-agent: GPTBot\nDisallow: /\n`);
    expect(effectiveGroup(p, "Mozilla/5.0 (compatible; Googlebot/2.1)")?.agents).toEqual(["Googlebot"]);
    expect(effectiveGroup(p, "Googlebot-Image/1.0")?.agents).toEqual(["Googlebot-Image"]);
    expect(effectiveGroup(p, "PerplexityBot/1.0")?.agents).toEqual(["*"]);
    expect(effectiveGroup(parseRobotsGroups("User-agent: GPTBot\nDisallow: /\n"), "Bingbot")).toBeUndefined();
    expect(verdictFor(effectiveGroup(p, "Googlebot"))).toBe("allowed");
    expect(verdictFor(effectiveGroup(p, "Googlebot-Image"))).toBe("blocked");
    expect(verdictFor(effectiveGroup(p, "GPTBot"))).toBe("blocked");
    expect(verdictFor(effectiveGroup(p, "PerplexityBot"))).toBe("partial");
    expect(verdictFor(effectiveGroup(p, "PerplexityBot"), "/private/x")).toBe("blocked");
    expect(verdictFor(undefined)).toBe("allowed");
    expect(verdictFor(parseRobotsGroups("User-agent: *\nDisallow: /\nAllow: /public\n").groups[0], "/public/a")).toBe("allowed");
  });

  test("健康 robots:全部 allowed(显式组里 partial 因 /admin/),ok,无 error,GoogleOther 记为未知 UA", () => {
    const r = runRobotsGate({ robotsTxt: HEALTHY });
    expect(r.ok).toBe(true);
    expect(r.wildcardBlocksAll).toBe(false);
    expect(r.sitemaps).toEqual(["https://demo-travel.ai/sitemap.xml"]);
    expect(r.reports).toHaveLength(21);
    expect(r.reports.find((x) => x.agent === "Googlebot")).toMatchObject({ verdict: "partial", matchedGroup: "Googlebot", class: "search", vendor: "Google" });
    expect(r.reports.find((x) => x.agent === "Bytespider")).toMatchObject({ verdict: "allowed", matchedGroup: "*" });
    expect(r.reports.filter((x) => x.verdict === "blocked")).toEqual([]);
    expect(r.unknownAgents).toEqual(["GoogleOther"]);
    expect(r.findings).toEqual([{ rule: "robots-unknown-agent", severity: "info", message: expect.any(String), evidence: "GoogleOther" }]);
  });

  test("变异:* 组注入 Disallow: / → 必红,且没显式组的搜索/用户类全部 blocked", () => {
    const mutated = HEALTHY.replace("User-Agent: *\nAllow: /\n", "User-Agent: *\nDisallow: /\n");
    const r = runRobotsGate({ robotsTxt: mutated });
    expect(r.ok).toBe(false);
    expect(r.wildcardBlocksAll).toBe(true);
    expect(r.findings[0]).toMatchObject({ rule: "robots-wildcard-block-all", severity: "error" });
    const blockedSearch = r.findings.filter((f) => f.rule === "robots-search-blocked").map((f) => f.evidence);
    expect(blockedSearch).toEqual(["Applebot", "DuckDuckBot", "YandexBot"]);
    expect(r.findings.filter((f) => f.rule === "robots-user-blocked").map((f) => f.evidence)).toEqual(["meta-externalfetcher"]);
    expect(r.reports.find((x) => x.agent === "OAI-SearchBot")?.verdict).toBe("partial");
    expect(r.reports.find((x) => x.agent === "Bytespider")?.verdict).toBe("blocked");
    expect(r.findings.some((f) => f.rule === "robots-training-policy")).toBe(false);
  });

  test("变异:单独封 DuckDuckBot 与 meta-externalfetcher → 两条 error;封训练类默认不出 finding", () => {
    const txt = `${HEALTHY}\nUser-agent: DuckDuckBot\nDisallow: /\n\nUser-agent: meta-externalfetcher\nDisallow: /\n\nUser-agent: Bytespider\nDisallow: /\n`;
    const r = runRobotsGate({ robotsTxt: txt });
    expect(r.ok).toBe(false);
    expect(r.findings.filter((f) => f.severity === "error").map((f) => [f.rule, f.evidence])).toEqual([
      ["robots-search-blocked", "DuckDuckBot"],
      ["robots-user-blocked", "meta-externalfetcher"],
    ]);
    expect(r.reports.find((x) => x.agent === "Bytespider")?.verdict).toBe("blocked");
    expect(r.findings.some((f) => f.rule === "robots-training-policy")).toBe(false);
  });

  test("策略:training=block 时未封的训练爬虫警告;training=allow 时被封的警告;search=any 不报错;缺 Sitemap 警告", () => {
    const txt = "User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n";
    const block = runRobotsGate({ robotsTxt: txt, policy: { training: "block" } });
    expect(block.ok).toBe(true);
    const warned = block.findings.filter((f) => f.rule === "robots-training-policy").map((f) => f.evidence);
    expect(warned).toEqual(["ClaudeBot", "anthropic-ai", "Google-Extended", "CCBot", "Bytespider", "Applebot-Extended", "meta-externalagent", "Amazonbot"]);
    expect(block.findings.some((f) => f.rule === "robots-sitemap-missing" && f.severity === "warn")).toBe(true);
    const allow = runRobotsGate({ robotsTxt: txt, policy: { training: "allow" }, requireSitemap: false });
    expect(allow.findings.map((f) => [f.rule, f.evidence])).toEqual([["robots-training-policy", "GPTBot"]]);
    const any = runRobotsGate({ robotsTxt: "User-agent: *\nDisallow: /\n", policy: { search: "any", user: "any" }, requireSitemap: false });
    expect(any.ok).toBe(false);
    expect(any.findings.map((f) => f.rule)).toEqual(["robots-wildcard-block-all"]);
  });

  test("fetchRobotsGate:200 跑门;404 当空 robots 加 robots-missing 警告;5xx 与抛错红", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      void init;
      if (url.startsWith("https://demo-travel.ai/")) return new Response(HEALTHY, { status: 200 });
      if (url.startsWith("https://none.demo-travel.ai/")) return new Response("", { status: 404 });
      if (url.startsWith("https://down.demo-travel.ai/")) return new Response("", { status: 503 });
      throw new Error("dns fail");
    });
    const f = fetchImpl as unknown as typeof fetch;
    const ok = await fetchRobotsGate({ origin: "https://demo-travel.ai", fetchImpl: f, userAgent: "DemoBot/1" });
    expect(ok.status).toBe(200);
    expect(ok.ok).toBe(true);
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://demo-travel.ai/robots.txt");
    expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get("user-agent")).toBe("DemoBot/1");

    const none = await fetchRobotsGate({ origin: "https://none.demo-travel.ai", fetchImpl: f });
    expect(none.status).toBe(404);
    expect(none.ok).toBe(true);
    expect(none.findings[0]).toMatchObject({ rule: "robots-missing", severity: "warn" });
    expect(none.findings.map((x) => x.rule)).toEqual(["robots-missing", "robots-sitemap-missing"]);
    expect(none.reports.every((x) => x.verdict === "allowed" && x.matchedGroup === "none")).toBe(true);

    const down = await fetchRobotsGate({ origin: "https://down.demo-travel.ai", fetchImpl: f });
    expect(down).toMatchObject({ ok: false, status: 503, reports: [], findings: [{ rule: "robots-status", severity: "error", evidence: "503" }] });
    const boom = await fetchRobotsGate({ origin: "https://boom.demo-travel.ai", fetchImpl: f });
    expect(boom).toMatchObject({ ok: false, status: 0, findings: [{ rule: "robots-status", evidence: "dns fail" }] });
  });
});