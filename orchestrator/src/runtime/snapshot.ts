import { copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface SnapshotResult { dir: string; files: number }

const DAY_MS = 24 * 3600 * 1000;

async function pathExists(path: string): Promise<boolean> {
  try {
    await readdir(path);
    return true;
  } catch {
    try {
      await readFile(path);
      return true;
    } catch {
      return false;
    }
  }
}

async function countFiles(dir: string): Promise<number> {
  let files = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      files += await countFiles(child);
    } else if (entry.isFile()) {
      files++;
    }
  }
  return files;
}

export async function snapshotState(stateDir: string, now: number, destRoot?: string): Promise<SnapshotResult> {
  const root = destRoot ?? join(stateDir, "snapshots");
  const dir = join(root, "snapshot-" + new Date(now).toISOString().replace(/[:.]/g, "-"));
  await mkdir(dir, { recursive: true });

  let files = 0;
  for (const name of ["projects.json", "auth.json"]) {
    const source = join(stateDir, name);
    if (await pathExists(source)) {
      await copyFile(source, join(dir, name));
      files++;
    }
  }

  const profiles = join(stateDir, "profiles");
  if (await pathExists(profiles)) {
    await cp(profiles, join(dir, "profiles"), { recursive: true });
    files += await countFiles(profiles);
  }

  return { dir, files };
}

export async function pruneSnapshots(destRoot: string, keep: number): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(destRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const snapshots = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("snapshot-"))
    .map((entry) => entry.name)
    .sort();
  const removeCount = Math.max(0, snapshots.length - Math.max(0, keep));
  const removed = snapshots.slice(0, removeCount);
  for (const name of removed) {
    await rm(join(destRoot, name), { recursive: true, force: true });
  }
  return removed;
}

export async function dailySnapshotIfDue(stateDir: string, now: number, destRoot?: string): Promise<SnapshotResult | null> {
  const root = destRoot ?? join(stateDir, "snapshots");
  const markerPath = join(root, "last.json");
  try {
    const marker = JSON.parse(await readFile(markerPath, "utf8")) as { at?: unknown };
    if (typeof marker.at === "number" && now - marker.at < DAY_MS) return null;
  } catch {
    // Missing or invalid marker means a fresh snapshot is due.
  }

  const result = await snapshotState(stateDir, now, root);
  await pruneSnapshots(root, 7);
  await writeFile(markerPath, JSON.stringify({ at: now }, null, 2), "utf8");
  return result;
}
