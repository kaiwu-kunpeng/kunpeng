import { productSlug } from "./artifacts.js";
import { appendActivity } from "./activity-log.js";
import {
  hardDeleteProduct as hardDeleteProductEntry,
  listProducts,
  migrateLegacy,
  restoreProduct as restoreProductEntry,
  softDeleteProduct,
  upsertProduct,
  type ProductEntry,
} from "./registry.js";

export async function ensureMigrated(repoRoot: string, now: number): Promise<void> {
  await migrateLegacy(repoRoot, now);
}

export async function createProduct(
  repoRoot: string,
  idea: string,
  now: number,
  sourceKind?: ProductEntry["sourceKind"],
  template?: string,
): Promise<ProductEntry> {
  const templateId = template?.trim();
  const entry: ProductEntry = {
    slug: productSlug(idea),
    title: idea,
    status: "active",
    createdAt: now,
    updatedAt: now,
    sourceKind: sourceKind ?? "scratch",
    ...(templateId ? { template: templateId } : {}),
  };
  await upsertProduct(repoRoot, entry);
  const summary = (sourceKind ?? "scratch") === "copy-ref" ? `从参考产品生成「${idea}」` : `新建产品「${idea}」`;
  await appendActivity(repoRoot, entry.slug, { ts: now, actor: "user", kind: "create", summary, stage: "define" });
  return entry;
}

export async function deleteProduct(
  repoRoot: string,
  slug: string,
  reason: string | undefined,
  now: number,
): Promise<void> {
  await softDeleteProduct(repoRoot, slug, reason, now);
  await appendActivity(repoRoot, slug, { ts: now, actor: "user", kind: "delete", summary: reason ? `删除产品（${reason}）` : "删除产品（软删）" });
}

export async function restoreProduct(repoRoot: string, slug: string, now: number): Promise<boolean> {
  const restored = await restoreProductEntry(repoRoot, slug, now);
  if (restored) {
    await appendActivity(repoRoot, slug, {
      ts: now,
      actor: "user",
      kind: "restore",
      summary: "恢复产品（撤销删除）",
      stage: "define",
    });
  }
  return restored;
}

export async function hardDeleteProduct(repoRoot: string, slug: string): Promise<boolean> {
  return hardDeleteProductEntry(repoRoot, slug);
}

export async function listProductsView(
  repoRoot: string,
  now: number,
  opts?: { includeArchived?: boolean },
): Promise<ProductEntry[]> {
  await ensureMigrated(repoRoot, now);
  return listProducts(repoRoot, opts);
}
