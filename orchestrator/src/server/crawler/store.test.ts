import { expect, it } from "vitest";
import { recordCrawlerHits, readAiVisibility, AI_CRAWLER_HITS_DDL, type SqlRunner } from "./store.js";
import type { ParsedHit } from "./drain-parse.js";
function fakeRunner(rows: unknown = []): { runner: SqlRunner; calls: Array<{ sql: string; params?: unknown[] }> } {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const runner: SqlRunner = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      return rows;
    },
  };
  return { runner, calls };
}
const hits: ParsedHit[] = [
  { ua: "Mozilla/5.0 (compatible; GPTBot/1.2)", path: "/parts/oem/1", status: 200, host: "h", ts: 1718000000000 },
  { ua: "Mozilla/5.0 Chrome/120", path: "/", status: 200, host: "h", ts: 1718000001000 }, // 非AI,丢
  { ua: "ChatGPT-User/1.0", path: "/parts/oem/2", status: 200, host: "h", ts: null },
];
it("DDL 是建表语句", () => {
  expect(AI_CRAWLER_HITS_DDL).toContain("ai_crawler_hits");
  expect(AI_CRAWLER_HITS_DDL.toLowerCase()).toContain("create table");
});
it("recordCrawlerHits 只插 AI 爬虫、参数化、返回条数", async () => {
  const { runner, calls } = fakeRunner();
  const n = await recordCrawlerHits(runner, "acme", hits);
  expect(n).toBe(2); // GPTBot + ChatGPT-User,Chrome 被滤
  const inserts = calls.filter((c) => /insert into ai_crawler_hits/i.test(c.sql));
  expect(inserts.length).toBe(2);
  expect(inserts[0].params).toBeDefined();
  // 参数里带 site 与规范 bot 名
  expect(JSON.stringify(inserts.map((c) => c.params))).toContain("GPTBot");
  expect(JSON.stringify(inserts.map((c) => c.params))).toContain("ChatGPT-User");
  expect(JSON.stringify(inserts.map((c) => c.params))).toContain("acme");
});
it("空输入不发 query、返回 0", async () => {
  const { runner, calls } = fakeRunner();
  expect(await recordCrawlerHits(runner, "acme", [])).toBe(0);
  expect(calls.length).toBe(0);
});
it("readAiVisibility 聚合 + 高亮 ChatGPT-User", async () => {
  const { runner } = fakeRunner([
    { bot: "ChatGPT-User", hits: 12 },
    { bot: "GPTBot", hits: 7 },
  ]);
  const v = await readAiVisibility(runner, { site: "acme", sinceDays: 7 });
  expect(v.byBot["ChatGPT-User"]).toBe(12);
  expect(v.chatgptUser).toBe(12);
  expect(v.total).toBe(19);
});
