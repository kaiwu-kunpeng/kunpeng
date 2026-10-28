import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { ensureMigrated, createProduct, deleteProduct, listProductsView } from "../../src/product/registry-service.js";

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kp-regsvc-"));
}

describe("product registry-service", () => {
  it("createProduct 由一句话建 active 条目、listProductsView 列出", async () => {
    const root = await tmp();
    const e = await createProduct(root, "我的新产品", 1000);
    expect(e.slug.length).toBeGreaterThan(0);
    expect(e.title).toBe("我的新产品");
    expect(e.status).toBe("active");
    expect(e.sourceKind).toBe("scratch");
    const list = await listProductsView(root, 1000);
    expect(list.map((p) => p.slug)).toContain(e.slug);
    await rm(root, { recursive: true, force: true });
  });

  it("createProduct 可标 sourceKind（如 copy-ref）", async () => {
    const root = await tmp();
    const e = await createProduct(root, "抄来的", 1, "copy-ref");
    expect(e.sourceKind).toBe("copy-ref");
    await rm(root, { recursive: true, force: true });
  });

  it("deleteProduct 后 listProductsView 不再含该产品", async () => {
    const root = await tmp();
    const e = await createProduct(root, "待删产品", 1000);
    await deleteProduct(root, e.slug, "测试", 2000);
    const list = await listProductsView(root, 2000);
    expect(list.map((p) => p.slug)).not.toContain(e.slug);
    await rm(root, { recursive: true, force: true });
  });

  it("listProductsView 先迁移：把既有 <slug>/state.json 折叠成 active", async () => {
    const root = await tmp();
    const dir = join(root, ".kunpeng", "product", "研发指挥仪表盘");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "state.json"), JSON.stringify({ currentStage: "design" }), "utf8");
    const list = await listProductsView(root, 100);
    expect(list.map((p) => p.slug)).toContain("研发指挥仪表盘");
    expect(list.find((p) => p.slug === "研发指挥仪表盘")?.currentStage).toBe("design");
    await rm(root, { recursive: true, force: true });
  });

  it("ensureMigrated 幂等：二次调用不抛、不重复", async () => {
    const root = await tmp();
    const dir = join(root, ".kunpeng", "product", "p1");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "state.json"), JSON.stringify({ currentStage: "spec" }), "utf8");
    await ensureMigrated(root, 1);
    await ensureMigrated(root, 2);
    const list = await listProductsView(root, 3);
    expect(list.filter((p) => p.slug === "p1").length).toBe(1);
    await rm(root, { recursive: true, force: true });
  });
});