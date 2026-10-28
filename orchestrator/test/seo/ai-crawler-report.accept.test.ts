import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { buildAiCrawlerReport } from "../../src/seo/ai-crawler-report.js";
import { AI_CRAWLERS } from "../../src/seo/bot-registry.js";
import { handleSeoMcp, type JsonRpcRequest, type SeoToolContext } from "../../src/seo/mcp-server.js";
import { buildSeoServeDeps } from "../../src/seo/serve-cmd.js";
import { builtinSeoTools } from "../../src/seo/tools.js";

const SEARCH = AI_CRAWLERS.filter((c) => c.class === "search").map((c) => c.name).sort();
const USER = AI_CRAWLERS.filter((c) => c.class === "user").map((c) => c.name).sort();

type Call = { tag: string; sql: string; params: unknown[] };
function fakeRunner(wrap: "array" | "rows") {
  const calls: Call[] = [];
  const data: Record<string, unknown[]> = {
    "-- ai-crawler:bot-day": [
      { bot: "GPTBot", day: "2026-09-27", hits: "100", last_seen: "2026-09-27T20:00:00Z" },
      { bot: "GPTBot", day: "2026-09-28", hits: 50, last_seen: "2026-09-28T09:00:00Z" },
      { bot: "OAI-SearchBot", day: "2026-09-28", hits: 30n, last_seen: "2026-09-28T15:18:03Z" },
      { bot: "ChatGPT-User", day: "2026-09-28", hits: 4, last_seen: "2026-09-28T14:20:28Z" },
      { bot: "LegacyBot", day: "2026-09-27", hits: 2, last_seen: "2026-09-27T01:00:00Z" },
    ],
    "-- ai-crawler:selection-counts": [{ search_paths: "120", user_paths: 3, overlap_paths: 2 }],
    "-- ai-crawler:top-user": [{ path: "/items/a", hits: 3 }, { path: "/items/b", hits: "1" }],
    "-- ai-crawler:top-crawled-not-fetched": [{ path: "/items/z", hits: 40 }],
  };
  return {
    calls,
    runner: {
      async query(sql: string, params: unknown[] = []) {
        const tag = sql.trimStart().split("\n")[0].trim();
        calls.push({ tag, sql, params });
        const rows = data[tag] ?? [];
        return wrap === "rows" ? { rows } : rows;
      },
    },
  };
}

describe("buildAiCrawlerReport（作者锁定）", () => {
  test("四条带标签的查询、参数顺序、site 缺省传 null", async () => {
    const { calls, runner } = fakeRunner("array");
    await buildAiCrawlerReport(runner, {});
    expect(calls.map((c) => c.tag).sort()).toEqual([
      "-- ai-crawler:bot-day", "-- ai-crawler:selection-counts", "-- ai-crawler:top-crawled-not-fetched", "-- ai-crawler:top-user",
    ]);
    const by = Object.fromEntries(calls.map((c) => [c.tag, c.params]));
    expect(by["-- ai-crawler:bot-day"]).toEqual([7, null]);
    expect(by["-- ai-crawler:selection-counts"]).toEqual([7, null, SEARCH, USER]);
    expect(by["-- ai-crawler:top-user"]).toEqual([7, null, USER, 20]);
    expect(by["-- ai-crawler:top-crawled-not-fetched"]).toEqual([7, null, SEARCH, USER, 20]);
    expect(calls).toHaveLength(4);
    for (const c of calls) {
      expect(c.sql).toContain("ai_crawler_hits");
      expect(c.sql).toContain("$2::text IS NULL OR site = $2");
    }
    const botDay = calls.find((c) => c.tag === "-- ai-crawler:bot-day")!.sql;
    expect(botDay).toMatch(/to_char\(/);
    expect(botDay).toContain(`'YYYY-MM-DD'`);
    expect(botDay).toContain(`'YYYY-MM-DD"T"HH24:MI:SS"Z"'`);
    expect(botDay).not.toMatch(/\.MS|MS"Z"|\bMS\b/);
    expect(SEARCH).toContain("OAI-SearchBot");
    expect(USER).toContain("ChatGPT-User");
  });

  test("site、sinceDays、limit 透传", async () => {
    const { calls, runner } = fakeRunner("rows");
    await buildAiCrawlerReport(runner, { site: "acme", sinceDays: 30, limit: 5 });
    const by = Object.fromEntries(calls.map((c) => [c.tag, c.params]));
    expect(by["-- ai-crawler:bot-day"]).toEqual([30, "acme"]);
    expect(by["-- ai-crawler:top-user"]).toEqual([30, "acme", USER, 5]);
    expect(by["-- ai-crawler:top-crawled-not-fetched"]).toEqual([30, "acme", SEARCH, USER, 5]);
  });

  test("汇总：分类、逐日、bot 排序、数字归一、未知爬虫", async () => {
    for (const wrap of ["array", "rows"] as const) {
      const { runner } = fakeRunner(wrap);
      const r = await buildAiCrawlerReport(runner, { site: "acme" });
      expect(r.site).toBe("acme");
      expect(r.sinceDays).toBe(7);
      expect(r.total).toBe(186);
      expect(r.byClass).toEqual({ training: 150, search: 30, user: 4, unknown: 2 });
      expect(r.bots).toEqual([
        { bot: "GPTBot", class: "training", vendor: "OpenAI", hits: 150, lastSeen: "2026-09-28T09:00:00Z" },
        { bot: "OAI-SearchBot", class: "search", vendor: "OpenAI", hits: 30, lastSeen: "2026-09-28T15:18:03Z" },
        { bot: "ChatGPT-User", class: "user", vendor: "OpenAI", hits: 4, lastSeen: "2026-09-28T14:20:28Z" },
        { bot: "LegacyBot", class: "unknown", vendor: null, hits: 2, lastSeen: "2026-09-27T01:00:00Z" },
      ]);
      expect(r.daily).toEqual([
        { day: "2026-09-27", training: 100, search: 0, user: 0, unknown: 2 },
        { day: "2026-09-28", training: 50, search: 30, user: 4, unknown: 0 },
      ]);
      expect(r.selection).toEqual({
        searchCrawledPaths: 120, userFetchedPaths: 3, overlapPaths: 2,
        topUserFetched: [{ path: "/items/a", hits: 3 }, { path: "/items/b", hits: 1 }],
        topCrawledNotFetched: [{ path: "/items/z", hits: 40 }],
      });
    }
  });
});

describe("seo_ai_crawler_report 工具接线（作者锁定）", () => {
  const tools = builtinSeoTools();
  const call = async (context: SeoToolContext, args: Record<string, unknown>) => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "seo_ai_crawler_report", arguments: args } };
    const res = await handleSeoMcp(req, { tools, context, outputBudgetChars: 200_000 });
    return JSON.parse((res!.result as { content: Array<{ text: string }> }).content[0].text);
  };
  const base: SeoToolContext = { repoRoot: "/tmp/demo-repo", fetchImpl: fetch, now: () => 1 };

  test("位置与注解", () => {
    const names = tools.map((t) => t.name);
    expect(names.indexOf("seo_ai_crawler_report")).toBe(names.indexOf("seo_robots_check") + 1);
    expect(names.indexOf("seo_retraction_sweep")).toBe(names.indexOf("seo_ai_crawler_report") + 1);
    const tool = tools.find((t) => t.name === "seo_ai_crawler_report")!;
    expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(tool.inputSchema.required ?? []).toEqual([]);
    expect(tool.inputSchema.properties).toEqual({ site: { type: "string" }, sinceDays: { type: "number" }, limit: { type: "number" } });
    expect(tool.inputSchema.additionalProperties).toBe(false);
  });

  test("没有数据库连接时明确报错", async () => {
    expect(await call(base, {})).toEqual({ ok: false, error: "NEON_DATABASE_URL 未配置，无法读取 ai_crawler_hits" });
  });

  test("有连接时返回报表；参数夹紧", async () => {
    const { calls, runner } = fakeRunner("rows");
    const out = await call({ ...base, sqlRunner: runner }, { site: "acme", sinceDays: 365, limit: 0 });
    expect(out.ok).toBe(true);
    expect(out.total).toBe(186);
    const by = Object.fromEntries(calls.map((c) => [c.tag, c.params]));
    expect(by["-- ai-crawler:bot-day"]).toEqual([90, "acme"]);
    expect(by["-- ai-crawler:top-user"]).toEqual([90, "acme", USER, 1]);
  });

  test("SqlRunner 类型取自爬虫存储模块（与写入端同一个接口）", () => {
    const src = readFileSync(new URL("../../src/seo/ai-crawler-report.ts", import.meta.url), "utf8");
    expect(src).toMatch(/import type \{[^}]*\bSqlRunner\b[^}]*\} from "\.\.\/server\/crawler\/store\.js"/);
  });

  test("serve 依赖：有 NEON_DATABASE_URL 才挂 sqlRunner", () => {
    expect(buildSeoServeDeps("/tmp/demo-repo", {}).context.sqlRunner).toBeUndefined();
    const deps = buildSeoServeDeps("/tmp/demo-repo", { NEON_DATABASE_URL: "postgresql://u:p@example.invalid/db" });
    expect(typeof deps.context.sqlRunner?.query).toBe("function");
  });
});