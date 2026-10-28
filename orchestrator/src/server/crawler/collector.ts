import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { kunpengStateDir } from "../../project/state-dir.js";
import { parseDrainPayload, type ParsedHit } from "./drain-parse.js";
import { AI_CRAWLER_HITS_DDL, recordCrawlerHits, type SqlRunner } from "./store.js";

export function siteFromHost(
  host: string | null,
  siteMap?: Record<string, string[]>,
): string {
  const normalized = host?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return "unknown";
  }

  for (const [site, fragments] of Object.entries(siteMap ?? {})) {
    for (const fragment of fragments) {
      const normalizedFragment = fragment.trim().toLowerCase();
      if (normalizedFragment && normalized.includes(normalizedFragment)) {
        return site;
      }
    }
  }

  return normalized;
}

function isCrawlerSiteMap(value: unknown): value is Record<string, string[]> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.entries(value).every(([site, fragments]) =>
    site.trim() !== ""
    && Array.isArray(fragments)
    && fragments.every((fragment) => typeof fragment === "string"),
  );
}

export async function loadCrawlerSiteMap(
  stateDir: string,
): Promise<Record<string, string[]>> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(stateDir, "crawler-sites.json"), "utf8"),
    );
    return isCrawlerSiteMap(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function ensureCrawlerTable(runner: SqlRunner): Promise<void> {
  const statements = AI_CRAWLER_HITS_DDL.split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await runner.query(statement);
  }
}

export async function handleDrainPayload(
  runner: SqlRunner,
  body: string,
): Promise<{ recorded: number }> {
  const hitsBySite = new Map<string, ParsedHit[]>();
  const siteMap = await loadCrawlerSiteMap(kunpengStateDir());

  for (const hit of parseDrainPayload(body)) {
    const site = siteFromHost(hit.host, siteMap);
    const siteHits = hitsBySite.get(site) ?? [];
    siteHits.push(hit);
    hitsBySite.set(site, siteHits);
  }

  let recorded = 0;
  for (const [site, siteHits] of hitsBySite) {
    recorded += await recordCrawlerHits(runner, site, siteHits);
  }

  return { recorded };
}
