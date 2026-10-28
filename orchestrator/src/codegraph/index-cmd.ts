import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildGraphFromDir, collectSourceMtimes } from "./builder.js";
import { injectIntoAgentsMd } from "./inject.js";
import { CodeGraphStore } from "./store.js";

export async function runCodegraphIndex(
  repoRoot: string,
): Promise<{ nodes: number; edges: number; skipped: boolean }> {
  const outDir = join(repoRoot, ".kunpeng", "codegraph");
  const graphPath = join(outDir, "graph.json");
  const mtimesPath = join(outDir, "_mtimes.json");
  const currentMtimes = collectSourceMtimes(repoRoot);
  const previousMtimes = readSourceMtimes(mtimesPath);

  if (
    previousMtimes !== null &&
    existsSync(graphPath) &&
    stableStringify(previousMtimes) === stableStringify(currentMtimes)
  ) {
    const stats = CodeGraphStore.fromJSON(readFileSync(graphPath, "utf8")).stats();
    return { ...stats, skipped: true };
  }

  const store = buildGraphFromDir(repoRoot);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(graphPath, store.toJSON());
  writeFileSync(mtimesPath, stableStringify(currentMtimes));
  injectIntoAgentsMd(join(repoRoot, "AGENTS.md"));

  return { ...store.stats(), skipped: false };
}

function readSourceMtimes(path: string): Record<string, number> | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;

    if (!isMtimesRecord(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function isMtimesRecord(value: unknown): value is Record<string, number> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((mtime) => typeof mtime === "number");
}

function stableStringify(mtimes: Record<string, number>): string {
  const sorted: Record<string, number> = {};

  for (const key of Object.keys(mtimes).sort()) {
    sorted[key] = mtimes[key];
  }

  return JSON.stringify(sorted);
}
