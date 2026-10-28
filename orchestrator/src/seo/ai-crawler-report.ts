import type { SqlRunner } from "../server/crawler/store.js";
import { isRecord } from "../util/is-record.js";
import { AI_CRAWLERS, type AiBotClass } from "./bot-registry.js";

type ClassCounts = Record<AiBotClass | "unknown", number>;
type PathHits = { path: string; hits: number };

export interface AiCrawlerReport {
  site: string | null;
  sinceDays: number;
  total: number;
  byClass: ClassCounts;
  bots: Array<{ bot: string; class: AiBotClass | "unknown"; vendor: string | null; hits: number; lastSeen: string }>;
  daily: Array<{ day: string } & ClassCounts>;
  selection: {
    searchCrawledPaths: number;
    userFetchedPaths: number;
    overlapPaths: number;
    topUserFetched: PathHits[];
    topCrawledNotFetched: PathHits[];
  };
}

const FILTER = `ts >= now() - ($1::int * interval '1 day')
  AND ($2::text IS NULL OR site = $2)`;
const PATH_FILTER = `${FILTER} AND path IS NOT NULL AND path <> ''`;

export async function buildAiCrawlerReport(
  runner: SqlRunner,
  opts: { site?: string; sinceDays?: number; limit?: number },
): Promise<AiCrawlerReport> {
  const site = opts.site ?? null;
  const sinceDays = opts.sinceDays ?? 7;
  const limit = opts.limit ?? 20;
  const searchBots = AI_CRAWLERS.filter((bot) => bot.class === "search").map((bot) => bot.name).sort();
  const userBots = AI_CRAWLERS.filter((bot) => bot.class === "user").map((bot) => bot.name).sort();

  const botDays = rowsFromResult(await runner.query(`-- ai-crawler:bot-day
SELECT bot, to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
       COUNT(*) AS hits,
       to_char(MAX(ts) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_seen
FROM ai_crawler_hits
WHERE ${FILTER}
GROUP BY bot, day
ORDER BY day ASC, bot ASC`, [sinceDays, site]));

  const counts = rowsFromResult(await runner.query(`-- ai-crawler:selection-counts
WITH paths AS (
  SELECT path, BOOL_OR(bot = ANY($3::text[])) AS search_seen,
         BOOL_OR(bot = ANY($4::text[])) AS user_seen
  FROM ai_crawler_hits
  WHERE ${PATH_FILTER}
    AND (bot = ANY($3::text[]) OR bot = ANY($4::text[]))
  GROUP BY path
)
SELECT COUNT(*) FILTER (WHERE search_seen) AS search_paths,
       COUNT(*) FILTER (WHERE user_seen) AS user_paths,
       COUNT(*) FILTER (WHERE search_seen AND user_seen) AS overlap_paths
FROM paths`, [sinceDays, site, searchBots, userBots]))[0];

  const topUser = rowsFromResult(await runner.query(`-- ai-crawler:top-user
SELECT path, COUNT(*) AS hits
FROM ai_crawler_hits
WHERE ${PATH_FILTER} AND bot = ANY($3::text[])
GROUP BY path
ORDER BY hits DESC, path ASC
LIMIT $4`, [sinceDays, site, userBots, limit]));

  const topNotFetched = rowsFromResult(await runner.query(`-- ai-crawler:top-crawled-not-fetched
SELECT path, COUNT(*) FILTER (WHERE bot = ANY($3::text[])) AS hits
FROM ai_crawler_hits
WHERE ${PATH_FILTER}
  AND (bot = ANY($3::text[]) OR bot = ANY($4::text[]))
GROUP BY path
HAVING BOOL_OR(bot = ANY($3::text[])) AND NOT BOOL_OR(bot = ANY($4::text[]))
ORDER BY hits DESC, path ASC
LIMIT $5`, [sinceDays, site, searchBots, userBots, limit]));

  const registry = new Map(AI_CRAWLERS.map((crawler) => [crawler.name, crawler]));
  const bots = new Map<string, AiCrawlerReport["bots"][number]>();
  const daily = new Map<string, AiCrawlerReport["daily"][number]>();
  const byClass = emptyCounts();
  let total = 0;
  for (const row of botDays) {
    const bot = stringField(row.bot);
    const day = stringField(row.day);
    const lastSeen = stringField(row.last_seen);
    const hits = countField(row.hits);
    const crawler = registry.get(bot);
    const botClass = crawler?.class ?? "unknown";
    total += hits;
    byClass[botClass] += hits;

    const summary = bots.get(bot) ?? { bot, class: botClass, vendor: crawler?.vendor ?? null, hits: 0, lastSeen };
    summary.hits += hits;
    if (lastSeen > summary.lastSeen) summary.lastSeen = lastSeen;
    bots.set(bot, summary);

    const trend = daily.get(day) ?? { day, ...emptyCounts() };
    trend[botClass] += hits;
    daily.set(day, trend);
  }

  return {
    site, sinceDays, total, byClass,
    bots: [...bots.values()].sort((a, b) => b.hits - a.hits || compareText(a.bot, b.bot)),
    daily: [...daily.values()].sort((a, b) => compareText(a.day, b.day)),
    selection: {
      searchCrawledPaths: counts === undefined ? 0 : countField(counts.search_paths),
      userFetchedPaths: counts === undefined ? 0 : countField(counts.user_paths),
      overlapPaths: counts === undefined ? 0 : countField(counts.overlap_paths),
      topUserFetched: pathHits(topUser),
      topCrawledNotFetched: pathHits(topNotFetched),
    },
  };
}

function emptyCounts(): ClassCounts {
  return { training: 0, search: 0, user: 0, unknown: 0 };
}

function rowsFromResult(result: unknown): Record<string, unknown>[] {
  const rows: unknown = Array.isArray(result) ? result : isRecord(result) ? result.rows : undefined;
  if (!Array.isArray(rows) || !rows.every(isRecord)) throw new Error("AI 爬虫查询结果格式无效");
  return rows;
}

function stringField(value: unknown): string {
  if (typeof value !== "string") throw new Error("AI 爬虫查询字符串字段无效");
  return value;
}

function countField(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "bigint" && typeof value !== "string") {
    throw new Error("AI 爬虫查询计数字段无效");
  }
  const count = Number(value);
  if (!Number.isFinite(count) || (typeof value === "string" && value.trim() === "")) {
    throw new Error("AI 爬虫查询计数字段无效");
  }
  return count;
}

function pathHits(rows: Record<string, unknown>[]): PathHits[] {
  return rows.map((row) => ({ path: stringField(row.path), hits: countField(row.hits) }));
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
