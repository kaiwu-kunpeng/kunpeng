// 产品轨 per-slug 文件存储：.kunpeng/product/<slug>/{state.json,spec.md,brief.json}。textual 产物纳入 git 跟踪。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DesignBrief } from "../design/brief-gate.js";
import { writeFileAtomic } from "../util/atomic-write.js";
import type { ProductValidation } from "./contract.js";
import { assertProductSlug } from "./slug-guard.js";
import type { ProductLoopState } from "./stage-machine.js";

export function productLoopDir(repoRoot: string, slug: string): string {
  return join(repoRoot, ".kunpeng", "product", assertProductSlug(slug));
}

async function ensureDir(repoRoot: string, slug: string): Promise<string> {
  const dir = productLoopDir(repoRoot, slug);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export function readLoopState(repoRoot: string, slug: string): Promise<ProductLoopState | undefined> {
  return readJson<ProductLoopState>(join(productLoopDir(repoRoot, slug), "state.json"));
}

export async function writeLoopState(repoRoot: string, state: ProductLoopState): Promise<void> {
  const dir = await ensureDir(repoRoot, state.slug);
  await writeFileAtomic(join(dir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
}

export async function readSpec(repoRoot: string, slug: string): Promise<string | undefined> {
  try {
    return await readFile(join(productLoopDir(repoRoot, slug), "spec.md"), "utf8");
  } catch {
    return undefined;
  }
}

export async function writeSpec(repoRoot: string, slug: string, md: string): Promise<void> {
  const dir = await ensureDir(repoRoot, slug);
  await writeFile(join(dir, "spec.md"), md, "utf8");
}

export function readBrief(repoRoot: string, slug: string): Promise<DesignBrief | undefined> {
  return readJson<DesignBrief>(join(productLoopDir(repoRoot, slug), "brief.json"));
}

export async function writeBrief(repoRoot: string, slug: string, brief: DesignBrief): Promise<void> {
  const dir = await ensureDir(repoRoot, slug);
  await writeFileAtomic(join(dir, "brief.json"), `${JSON.stringify(brief, null, 2)}\n`);
}

export async function readBuildSpec(repoRoot: string, slug: string): Promise<string | undefined> {
  try {
    return await readFile(join(productLoopDir(repoRoot, slug), "build-spec.md"), "utf8");
  } catch {
    return undefined;
  }
}

export async function writeBuildSpec(repoRoot: string, slug: string, md: string): Promise<void> {
  const dir = await ensureDir(repoRoot, slug);
  await writeFile(join(dir, "build-spec.md"), md, "utf8");
}

export async function readValidation(repoRoot: string, slug: string): Promise<ProductValidation | undefined> {
  return readJson<ProductValidation>(join(productLoopDir(repoRoot, slug), "validation.json"));
}

export async function writeValidation(repoRoot: string, slug: string, v: ProductValidation): Promise<void> {
  const dir = await ensureDir(repoRoot, slug);
  await writeFileAtomic(join(dir, "validation.json"), `${JSON.stringify(v, null, 2)}\n`);
}
