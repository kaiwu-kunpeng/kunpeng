import { isRecord } from "../../util/is-record.js";
import type { ParsedHit } from "./drain-parse.js";
import { aiBotFromUA } from "./ua-classify.js";

export interface SqlRunner {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

export const AI_CRAWLER_HITS_DDL = `
CREATE TABLE IF NOT EXISTS ai_crawler_hits (
  id BIGSERIAL PRIMARY KEY,
  site TEXT NOT NULL,
  bot TEXT NOT NULL,
  ua TEXT NOT NULL,
  path TEXT,
  status INT,
  ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_crawler_hits_site_bot_ts_idx
  ON ai_crawler_hits (site, bot, ts);
`;

export async function recordCrawlerHits(runner: SqlRunner, site: string, hits: ParsedHit[]): Promise<number> {
  if (hits.length === 0) {
    return 0;
  }

  const now = new Date();
  let inserted = 0;

  for (const hit of hits) {
    const bot = aiBotFromUA(hit.ua);
    if (bot === null) {
      continue;
    }

    await runner.query(
      `
INSERT INTO ai_crawler_hits (site, bot, ua, path, status, ts)
VALUES ($1, $2, $3, $4, $5, $6)
`,
      [site, bot, hit.ua, hit.path, hit.status, hit.ts ? new Date(hit.ts) : now],
    );
    inserted += 1;
  }

  return inserted;
}

export interface AiVisibility {
  total: number;
  chatgptUser: number;
  byBot: Record<string, number>;
  topPaths: Array<{ path: string; hits: number }>;
}

export async function readAiVisibility(
  runner: SqlRunner,
  opts: { site?: string; sinceDays?: number },
): Promise<AiVisibility> {
  const sinceDays = opts.sinceDays ?? 7;
  const { whereSql, params } = buildVisibilityFilter(opts.site, sinceDays);
  const botRows = rowsFromResult(
    await runner.query(
      `
SELECT bot, COUNT(*)::int AS hits
FROM ai_crawler_hits
${whereSql}
GROUP BY bot
ORDER BY hits DESC, bot ASC
`,
      params,
    ),
  );

  const pathRows = rowsFromResult(
    await runner.query(
      `
SELECT path, COUNT(*)::int AS hits
FROM ai_crawler_hits
${whereSql} AND path IS NOT NULL AND path <> ''
GROUP BY path
ORDER BY hits DESC, path ASC
LIMIT 10
`,
      params,
    ),
  );

  const byBot: Record<string, number> = {};
  for (const row of botRows) {
    const bot = readStringField(row, "bot");
    const hits = readCountField(row, "hits");
    if (bot === null || hits === null) {
      continue;
    }
    byBot[bot] = (byBot[bot] ?? 0) + hits;
  }

  const topPaths: Array<{ path: string; hits: number }> = [];
  for (const row of pathRows) {
    const path = readStringField(row, "path");
    const hits = readCountField(row, "hits");
    if (path === null || hits === null) {
      continue;
    }
    topPaths.push({ path, hits });
  }

  const total = Object.values(byBot).reduce((sum, hits) => sum + hits, 0);
  return {
    total,
    chatgptUser: byBot["ChatGPT-User"] ?? 0,
    byBot,
    topPaths,
  };
}

function buildVisibilityFilter(site: string | undefined, sinceDays: number): { whereSql: string; params: unknown[] } {
  const clauses = ["ts >= now() - ($1::int * interval '1 day')"];
  const params: unknown[] = [sinceDays];

  if (site !== undefined) {
    params.push(site);
    clauses.push(`site = $${params.length}`);
  }

  return {
    whereSql: `WHERE ${clauses.join(" AND ")}`,
    params,
  };
}

function rowsFromResult(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) {
    return result.filter(isRecord);
  }

  if (isRecord(result) && Array.isArray(result.rows)) {
    return result.rows.filter(isRecord);
  }

  return [];
}

function readStringField(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  return typeof value === "string" ? value : null;
}

function readCountField(row: Record<string, unknown>, field: string): number | null {
  const value = row[field];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
