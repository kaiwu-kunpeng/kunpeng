import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withDirLock } from "../taskboard/lock.js";
import { writeFileAtomic } from "../util/atomic-write.js";
import { assertProductSlug } from "./slug-guard.js";

export type ProductStatus = "active" | "archived";

export interface ProductEntry {
  slug: string;
  title: string;
  currentStage?: string;
  status: ProductStatus;
  createdAt: number;
  updatedAt: number;
  sourceKind?: "scratch" | "copy-ref" | "duplicate";
  template?: string;
}

export interface ProductRegistry {
  products: ProductEntry[];
}

export interface Tombstone {
  slug: string;
  deletedAt: number;
  reason?: string;
}

function productDir(repoRoot: string): string {
  return join(repoRoot, ".kunpeng", "product");
}

function registryPath(repoRoot: string): string {
  return join(productDir(repoRoot), "index.json");
}

function tombstonePath(repoRoot: string, slug: string): string {
  return join(productDir(repoRoot), slug, "tombstone.json");
}

export async function readRegistry(repoRoot: string): Promise<ProductRegistry> {
  try {
    return JSON.parse(await readFile(registryPath(repoRoot), "utf8")) as ProductRegistry;
  } catch {
    return { products: [] };
  }
}

export async function writeRegistry(repoRoot: string, reg: ProductRegistry): Promise<void> {
  await mkdir(productDir(repoRoot), { recursive: true });
  await writeFileAtomic(registryPath(repoRoot), `${JSON.stringify(reg, null, 2)}\n`);
}

export async function listProducts(
  repoRoot: string,
  opts?: { includeArchived?: boolean },
): Promise<ProductEntry[]> {
  const reg = await readRegistry(repoRoot);
  if (opts?.includeArchived === true) return reg.products;
  return reg.products.filter((product) => product.status === "active");
}

export async function upsertProduct(repoRoot: string, entry: ProductEntry): Promise<void> {
  await withDirLock(productDir(repoRoot), async () => {
    const reg = await readRegistry(repoRoot);
    const index = reg.products.findIndex((product) => product.slug === entry.slug);
    if (index >= 0) {
      reg.products[index] = entry;
    } else {
      reg.products.push(entry);
    }
    await writeRegistry(repoRoot, reg);
  });
}

export async function softDeleteProduct(
  repoRoot: string,
  slug: string,
  reason: string | undefined,
  now: number,
): Promise<void> {
  await withDirLock(productDir(repoRoot), async () => {
    const reg = await readRegistry(repoRoot);
    const existing = reg.products.find((product) => product.slug === slug);
    if (existing) {
      existing.status = "archived";
      existing.updatedAt = now;
    }

    const tombstone: Tombstone = { slug, deletedAt: now, reason };
    await mkdir(join(productDir(repoRoot), slug), { recursive: true });
    await writeFile(tombstonePath(repoRoot, slug), `${JSON.stringify(tombstone, null, 2)}\n`, "utf8");
    await writeRegistry(repoRoot, reg);
  });
}

export async function restoreProduct(repoRoot: string, slug: string, now: number): Promise<boolean> {
  return withDirLock(productDir(repoRoot), async () => {
    const reg = await readRegistry(repoRoot);
    const existing = reg.products.find((product) => product.slug === slug);
    if (!existing) return false;

    existing.status = "active";
    existing.updatedAt = now;
    await writeRegistry(repoRoot, reg);

    try {
      await unlink(tombstonePath(repoRoot, slug));
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }

    return true;
  });
}

export async function hardDeleteProduct(repoRoot: string, slug: string): Promise<boolean> {
  assertProductSlug(slug);
  return withDirLock(productDir(repoRoot), async () => {
    const reg = await readRegistry(repoRoot);
    const before = reg.products.length;
    reg.products = reg.products.filter((product) => product.slug !== slug);
    await writeRegistry(repoRoot, reg);
    await rm(join(productDir(repoRoot), slug), { recursive: true, force: true });
    return reg.products.length !== before;
  });
}

export async function migrateLegacy(repoRoot: string, now: number): Promise<number> {
  try {
    JSON.parse(await readFile(registryPath(repoRoot), "utf8"));
    return 0;
  } catch (error) {
    if (!isMissingFileError(error)) return 0;
  }

  let entries: Dirent[];
  try {
    entries = await readdir(productDir(repoRoot), { withFileTypes: true });
  } catch {
    return 0;
  }

  const products: ProductEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === ".trash") continue;
    const state = await readLegacyState(repoRoot, entry.name);
    if (!state) continue;
    products.push({
      slug: entry.name,
      title: entry.name,
      currentStage: typeof state.currentStage === "string" ? state.currentStage : undefined,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  }

  await writeRegistry(repoRoot, { products });
  return products.length;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

async function readLegacyState(repoRoot: string, slug: string): Promise<{ currentStage?: unknown } | undefined> {
  try {
    const data = JSON.parse(await readFile(join(productDir(repoRoot), slug, "state.json"), "utf8"));
    return typeof data === "object" && data !== null ? data as { currentStage?: unknown } : {};
  } catch {
    return undefined;
  }
}
