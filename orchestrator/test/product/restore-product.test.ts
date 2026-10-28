import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { createProduct, deleteProduct, restoreProduct, listProductsView } from "../../src/product/registry-service.js";

async function tmp(): Promise<string> { return mkdtemp(join(tmpdir(), "kp-restore-")); }

describe("restoreProduct", () => {
  it("删除后 restore → 重新出现在 active 列表；includeArchived 能看到 archived", async () => {
    const root = await tmp();
    const e = await createProduct(root, "我的产品", 1000);
    await deleteProduct(root, e.slug, undefined, 2000);
    // 默认列表（active-only）不含已删除
    expect((await listProductsView(root, 2500)).find((p) => p.slug === e.slug)).toBeUndefined();
    // includeArchived 能看到，且状态为 archived
    const withArch = await listProductsView(root, 2600, { includeArchived: true });
    expect(withArch.find((p) => p.slug === e.slug)?.status).toBe("archived");
    // 恢复
    expect(await restoreProduct(root, e.slug, 3000)).toBe(true);
    expect((await listProductsView(root, 3500)).find((p) => p.slug === e.slug)?.status).toBe("active");
    await rm(root, { recursive: true, force: true });
  });

  it("恢复不存在的 slug → false", async () => {
    const root = await tmp();
    expect(await restoreProduct(root, "nope", 1)).toBe(false);
    await rm(root, { recursive: true, force: true });
  });
});