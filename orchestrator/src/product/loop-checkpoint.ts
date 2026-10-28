import { mkdir, readdir, readFile, copyFile, access } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../util/atomic-write.js";
import { productLoopDir } from "./loop-store.js";

const LOOP_FILES = ["state.json", "spec.md", "brief.json", "build-spec.md", "validation.json"];

export interface CheckpointMeta {
  id: string;
  ts: number;
  label: string;
  stage?: string;
}

function ckptsDir(repoRoot: string, slug: string): string {
  return join(productLoopDir(repoRoot, slug), ".checkpoints");
}

function ckptDir(repoRoot: string, slug: string, id: string): string {
  return join(ckptsDir(repoRoot, slug), id);
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function readCurrentStage(loopDir: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(loopDir, "state.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("currentStage" in parsed)) {
      return undefined;
    }
    const currentStage = (parsed as { currentStage?: unknown }).currentStage;
    return typeof currentStage === "string" && currentStage.trim().length > 0 ? currentStage : undefined;
  } catch {
    return undefined;
  }
}

export async function snapshotLoop(repoRoot: string, slug: string, label: string, now: number): Promise<string> {
  const id = String(now);
  const loopDir = productLoopDir(repoRoot, slug);
  const dir = ckptDir(repoRoot, slug, id);
  await mkdir(dir, { recursive: true });

  for (const file of LOOP_FILES) {
    const src = join(loopDir, file);
    if (await exists(src)) {
      await copyFile(src, join(dir, file));
    }
  }

  const meta: CheckpointMeta = { id, ts: now, label };
  const stage = await readCurrentStage(loopDir);
  if (stage !== undefined) meta.stage = stage;
  await writeFileAtomic(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  return id;
}

export async function listCheckpoints(repoRoot: string, slug: string): Promise<CheckpointMeta[]> {
  const dir = ckptsDir(repoRoot, slug);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const metas: CheckpointMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const raw = await readFile(join(dir, entry.name, "meta.json"), "utf8");
      metas.push(JSON.parse(raw) as CheckpointMeta);
    } catch {
      continue;
    }
  }

  return metas.sort((a, b) => b.ts - a.ts);
}

export async function restoreCheckpoint(repoRoot: string, slug: string, id: string, now: number): Promise<boolean> {
  const dir = ckptDir(repoRoot, slug, id);
  if (!(await exists(dir))) return false;

  await snapshotLoop(repoRoot, slug, "回滚前自动存", now);

  const loopDir = productLoopDir(repoRoot, slug);
  await mkdir(loopDir, { recursive: true });
  for (const file of LOOP_FILES) {
    const src = join(dir, file);
    if (await exists(src)) {
      await copyFile(src, join(loopDir, file));
    }
  }

  return true;
}
