import { mkdtemp, rm, mkdir, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { createProduct, deleteProduct, hardDeleteProduct, listProductsView } from "../../src/product/registry-service.js";

async function tmp(): Promise<string> { return mkdtemp(join(tmpdir(), "kp-hard-")); }
function exists(p: string): Promise<boolean> { return access(p).then(() => true).catch(() => false); }

describe("hardDeleteProduct", () => {
  it("硬删：registry entry 移除 + 产品目录删除，连 archived 列表也不含", async () => {
    const root = await tmp();
    const e = await createProduct(root, "临时产品", 1000);
    const dir = join(root, ".kunpeng", "product", e.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "spec.md"), "x", "utf8");
    await deleteProduct(root, e.slug, undefined, 2000);
    expect(await exists(dir)).toBe(true);

    expect(await hardDeleteProduct(root, e.slug)).toBe(true);
    const all = await listProductsView(root, 3000, { includeArchived: true });
    expect(all.find((p) => p.slug === e.slug)).toBeUndefined();
    expect(await exists(dir)).toBe(false);
    await rm(root, { recursive: true, force: true });
  });

  it("硬删不存在的 slug → false（目录本就没有，registry 无变化）", async () => {
    const root = await tmp();
    await createProduct(root, "保留产品", 1000);
    expect(await hardDeleteProduct(root, "不存在")).toBe(false);
    expect((await listProductsView(root, 2000)).length).toBe(1);
    await rm(root, { recursive: true, force: true });
  });
});