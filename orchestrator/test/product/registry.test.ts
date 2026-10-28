import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listProducts,
  migrateLegacy,
  readRegistry,
  softDeleteProduct,
  upsertProduct,
  writeRegistry,
} from "../../src/product/registry.js";
import type { ProductEntry } from "../../src/product/registry.js";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kp-product-registry-"));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function product(overrides: Partial<ProductEntry> = {}): ProductEntry {
  return {
    slug: "command-dashboard",
    title: "研发指挥仪表盘",
    currentStage: "shape",
    status: "active",
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe("product registry", () => {
  it("readRegistry returns an empty registry when index is missing or malformed", async () => {
    expect(await readRegistry(repo)).toEqual({ products: [] });

    mkdirSync(join(repo, ".kunpeng", "product"), { recursive: true });
    writeFileSync(join(repo, ".kunpeng", "product", "index.json"), "not json", "utf8");

    expect(await readRegistry(repo)).toEqual({ products: [] });
  });

  it("writeRegistry writes pretty JSON and listProducts hides archived products by default", async () => {
    const active = product();
    const archived = product({ slug: "old-product", title: "旧产品", status: "archived" });

    await writeRegistry(repo, { products: [active, archived] });

    expect(readFileSync(join(repo, ".kunpeng", "product", "index.json"), "utf8")).toBe(
      `${JSON.stringify({ products: [active, archived] }, null, 2)}\n`,
    );
    expect(await listProducts(repo)).toEqual([active]);
    expect(await listProducts(repo, { includeArchived: true })).toEqual([active, archived]);
  });

  it("upsertProduct appends new products and replaces existing products by slug", async () => {
    const first = product({ currentStage: "define", updatedAt: 1000 });
    const replacement = product({ currentStage: "validate", updatedAt: 2000 });
    const second = product({ slug: "another-product", title: "另一个产品" });

    await upsertProduct(repo, first);
    await upsertProduct(repo, second);
    await upsertProduct(repo, replacement);

    expect(await readRegistry(repo)).toEqual({ products: [replacement, second] });
  });

  it("softDeleteProduct writes tombstone, archives the registry entry, and default list excludes it", async () => {
    await writeRegistry(repo, { products: [product()] });

    await softDeleteProduct(repo, "command-dashboard", "用户删除", 3000);

    expect(JSON.parse(readFileSync(join(repo, ".kunpeng", "product", "command-dashboard", "tombstone.json"), "utf8"))).toEqual({
      slug: "command-dashboard",
      deletedAt: 3000,
      reason: "用户删除",
    });
    expect(await readRegistry(repo)).toEqual({
      products: [product({ status: "archived", updatedAt: 3000 })],
    });
    expect(await listProducts(repo)).toEqual([]);
    expect(await listProducts(repo, { includeArchived: true })).toEqual([
      product({ status: "archived", updatedAt: 3000 }),
    ]);
  });

  it("softDeleteProduct writes a tombstone even when the registry entry is absent", async () => {
    await softDeleteProduct(repo, "missing-product", undefined, 4000);

    expect(JSON.parse(readFileSync(join(repo, ".kunpeng", "product", "missing-product", "tombstone.json"), "utf8"))).toEqual({
      slug: "missing-product",
      deletedAt: 4000,
    });
    expect(await readRegistry(repo)).toEqual({ products: [] });
  });

  it("migrateLegacy folds existing state.json directories into active products and is idempotent", async () => {
    mkdirSync(join(repo, ".kunpeng", "product", "研发指挥仪表盘"), { recursive: true });
    writeFileSync(
      join(repo, ".kunpeng", "product", "研发指挥仪表盘", "state.json"),
      JSON.stringify({ currentStage: "discover" }),
      "utf8",
    );
    mkdirSync(join(repo, ".kunpeng", "product", "no-state"), { recursive: true });
    mkdirSync(join(repo, ".kunpeng", "product", ".trash"), { recursive: true });

    expect(await migrateLegacy(repo, 5000)).toBe(1);
    expect(await readRegistry(repo)).toEqual({
      products: [{
        slug: "研发指挥仪表盘",
        title: "研发指挥仪表盘",
        currentStage: "discover",
        status: "active",
        createdAt: 5000,
        updatedAt: 5000,
      }],
    });
    expect(await listProducts(repo)).toEqual([{
      slug: "研发指挥仪表盘",
      title: "研发指挥仪表盘",
      currentStage: "discover",
      status: "active",
      createdAt: 5000,
      updatedAt: 5000,
    }]);

    expect(await migrateLegacy(repo, 6000)).toBe(0);
    expect((await readRegistry(repo)).products).toHaveLength(1);
  });

  it("migrateLegacy returns zero when the product directory does not exist", async () => {
    expect(existsSync(join(repo, ".kunpeng", "product"))).toBe(false);

    expect(await migrateLegacy(repo, 5000)).toBe(0);

    expect(existsSync(join(repo, ".kunpeng", "product", "index.json"))).toBe(false);
  });
});
