import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildLibraryIndex, searchLibrary, type BuildLibraryIndexOptions } from "../../library/scan.js";
import type { LibraryEntry, LibraryEntryStatus, LibraryEntryType } from "../../library/entry.js";
import { registerModularRoute, type RouteContext } from "./registry.js";

const TYPES = new Set<LibraryEntryType>(["spec", "doc", "capture", "skill"]);
const STATUSES = new Set<LibraryEntryStatus>(["draft", "active", "archived"]);

function buildOptions(context: RouteContext): BuildLibraryIndexOptions {
  return {
    specsDir: process.env.KP_LIBRARY_SPECS_DIR || join(homedir(), "kunpeng-specs"),
    docsDir: process.env.KP_LIBRARY_DOCS_DIR || join(homedir(), "kunpeng-strategy-docs"),
    skillsRoot: join(context.stateDir, "skills"),
    stateDir: context.stateDir,
  };
}

async function readOrBuild(context: RouteContext): Promise<LibraryEntry[]> {
  const indexPath = join(context.stateDir, "library", "index.json");
  try {
    return JSON.parse(await readFile(indexPath, "utf8")) as LibraryEntry[];
  } catch (error) {
    if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") throw error;
    return (await buildLibraryIndex(buildOptions(context))).entries;
  }
}

registerModularRoute({
  method: "GET",
  path: "/api/library",
  handle: async (_req, res, url, context) => {
    const query = new URL(url, "http://localhost").searchParams;
    const type = query.get("type") ?? undefined;
    const status = query.get("status") ?? undefined;
    const audience = query.get("audience") ?? undefined;
    if ((type !== undefined && !TYPES.has(type as LibraryEntryType))
      || (status !== undefined && !STATUSES.has(status as LibraryEntryStatus))
      || (audience !== undefined && audience !== "human" && audience !== "agent")) {
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "invalid library filter" }));
      return;
    }
    const entries = searchLibrary(await readOrBuild(context), query.get("q") ?? "", {
      ...(type ? { type: type as LibraryEntryType } : {}),
      ...(status ? { status: status as LibraryEntryStatus } : {}),
      ...(query.get("review") === "1" ? { needsReview: true } : {}),
      ...(audience ? { audience: audience as "human" | "agent" } : {}),
    });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, entries }));
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/library/scan",
  handle: async (_req, res, _url, context) => {
    const { entries } = await buildLibraryIndex(buildOptions(context));
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, count: entries.length }));
  },
});
