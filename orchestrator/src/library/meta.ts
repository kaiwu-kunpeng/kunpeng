import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { LibraryEntry } from "./entry.js";

export type LibraryEntryMeta = Partial<Pick<LibraryEntry,
  "status" | "tags" | "audience" | "trigger" | "verifyUntil"
>>;

export type LibraryMeta = Record<string, LibraryEntryMeta>;

function metaPath(stateDir: string): string {
  return join(resolve(stateDir), "library", "meta.json");
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseMeta(raw: string): LibraryMeta {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("library meta must be an object");
  }
  const result: LibraryMeta = {};
  for (const [id, candidate] of Object.entries(value)) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new TypeError(`library meta for ${id} must be an object`);
    }
    const item = candidate as Record<string, unknown>;
    const allowed = new Set(["status", "tags", "audience", "trigger", "verifyUntil"]);
    if (Object.keys(item).some((key) => !allowed.has(key))) {
      throw new TypeError(`library meta for ${id} contains an unknown field`);
    }
    if (item.status !== undefined && !["draft", "active", "archived"].includes(item.status as string)) {
      throw new TypeError(`library meta for ${id} has an invalid status`);
    }
    if (item.tags !== undefined && !isStringArray(item.tags)) {
      throw new TypeError(`library meta for ${id} has invalid tags`);
    }
    if (item.audience !== undefined && item.audience !== "human" && item.audience !== "agent") {
      throw new TypeError(`library meta for ${id} has an invalid audience`);
    }
    if (item.trigger !== undefined && typeof item.trigger !== "string") {
      throw new TypeError(`library meta for ${id} has an invalid trigger`);
    }
    if (item.verifyUntil !== undefined && (typeof item.verifyUntil !== "number" || !Number.isFinite(item.verifyUntil))) {
      throw new TypeError(`library meta for ${id} has an invalid verifyUntil`);
    }
    result[id] = item as LibraryEntryMeta;
  }
  return result;
}

export async function readMeta(stateDir: string): Promise<LibraryMeta> {
  try {
    return parseMeta(await readFile(metaPath(stateDir), "utf8"));
  } catch (error) {
    if (isMissing(error)) return {};
    throw error;
  }
}

export async function setEntryMeta(stateDir: string, id: string, patch: LibraryEntryMeta): Promise<void> {
  const path = metaPath(stateDir);
  const current = await readMeta(stateDir);
  const provided = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as LibraryEntryMeta;
  const next: LibraryMeta = {
    ...current,
    [id]: { ...current[id], ...provided },
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export function applyMeta(entries: LibraryEntry[], meta: LibraryMeta, now: number): LibraryEntry[] {
  return entries.map((item) => {
    const overlaid = { ...item, ...meta[item.id] };
    return {
      ...overlaid,
      needsReview: overlaid.verifyUntil !== undefined && overlaid.verifyUntil < now,
    };
  });
}
