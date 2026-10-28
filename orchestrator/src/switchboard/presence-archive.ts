import { access, mkdir, readFile, readdir, rename } from "node:fs/promises";
import { join } from "node:path";

export const PRESENCE_KEEP_DAYS = 7;

export interface PresenceArchiveCandidate {
  file: string;
  ts?: unknown;
}

export interface PresenceArchiveClassification {
  archive: string[];
  keep: string[];
  unclassified: string[];
}

export interface PresenceArchiveOptions {
  presenceDir: string;
  archiveRoot: string;
  nowMs: number;
  dateLabel: string;
  keepDays?: number;
}

export interface PresenceArchiveResult {
  archived: number;
  kept: number;
  unclassified: number;
  archiveDir: string;
}

export function classifyPresenceForArchive(
  candidates: PresenceArchiveCandidate[],
  nowMs: number,
  keepDays = PRESENCE_KEEP_DAYS,
): PresenceArchiveClassification {
  const classification: PresenceArchiveClassification = {
    archive: [],
    keep: [],
    unclassified: [],
  };

  if (!Number.isFinite(nowMs)) {
    classification.keep.push(...candidates.map((candidate) => candidate.file));
  } else {
    const cutoff = nowMs - keepDays * 86_400_000;
    for (const candidate of candidates) {
      if (typeof candidate.ts !== "number" || !Number.isFinite(candidate.ts)) {
        classification.unclassified.push(candidate.file);
      } else if (candidate.ts >= cutoff) {
        classification.keep.push(candidate.file);
      } else {
        classification.archive.push(candidate.file);
      }
    }
  }

  classification.archive.sort();
  classification.keep.sort();
  classification.unclassified.sort();
  return classification;
}

export async function archiveStalePresence(
  options: PresenceArchiveOptions,
): Promise<PresenceArchiveResult> {
  const archiveDir = join(options.archiveRoot, options.dateLabel);
  const emptyResult: PresenceArchiveResult = {
    archived: 0,
    kept: 0,
    unclassified: 0,
    archiveDir,
  };

  let entries;
  try {
    entries = await readdir(options.presenceDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingPath(error)) return emptyResult;
    throw error;
  }

  const filenames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name);
  const candidates: PresenceArchiveCandidate[] = [];

  for (const filename of filenames) {
    try {
      const value = JSON.parse(
        await readFile(join(options.presenceDir, filename), "utf8"),
      ) as unknown;
      candidates.push({ file: filename, ts: readTimestamp(value) });
    } catch {
      candidates.push({ file: filename });
    }
  }

  const classification = classifyPresenceForArchive(
    candidates,
    options.nowMs,
    options.keepDays,
  );
  const result: PresenceArchiveResult = {
    archived: 0,
    kept: classification.keep.length,
    unclassified: classification.unclassified.length,
    archiveDir,
  };

  if (classification.archive.length === 0) return result;
  await mkdir(archiveDir, { recursive: true });

  for (const filename of classification.archive) {
    const source = join(options.presenceDir, filename);
    const target = join(archiveDir, filename);
    try {
      if (await pathExists(target)) {
        result.unclassified += 1;
        continue;
      }
      await rename(source, target);
      result.archived += 1;
    } catch {
      result.unclassified += 1;
    }
  }

  return result;
}

function readTimestamp(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("ts" in value)) return undefined;
  return value.ts;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isMissingPath(error)) return false;
    throw error;
  }
}

function isMissingPath(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
