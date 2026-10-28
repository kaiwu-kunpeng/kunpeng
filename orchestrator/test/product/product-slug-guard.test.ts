import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { assertProductSlug, isValidProductSlug } from "../../src/product/slug-guard.js";
import { productLoopDir } from "../../src/product/loop-store.js";
import { productWorkspaceDir } from "../../src/product/workspace.js";
import { hardDeleteProduct } from "../../src/product/registry.js";

const BAD = ["..", "../..", "a/b", "", "../../../../tmp", "./x", "a\\b"];

describe("assertProductSlug", () => {
  it("穿越型与空 slug 一律抛错", () => {
    for (const bad of BAD) {
      expect(() => assertProductSlug(bad), `应拒绝: ${JSON.stringify(bad)}`).toThrow();
    }
  });

  it("合法 slug 原样返回", () => {
    expect(assertProductSlug("my-product")).toBe("my-product");
    expect(assertProductSlug("临时产品")).toBe("临时产品");
    expect(isValidProductSlug("my-product")).toBe(true);
    expect(isValidProductSlug("..")).toBe(false);
  });
});

describe("三个拼路径咽喉点 fail-closed", () => {
  it("productLoopDir 对穿越 slug 抛错", () => {
    expect(() => productLoopDir("/tmp/kp-root", "..")).toThrow();
    expect(productLoopDir("/tmp/kp-root", "ok-slug")).toContain("ok-slug");
  });

  it("productWorkspaceDir 对穿越 slug 抛错", () => {
    expect(() => productWorkspaceDir("/tmp/kp-root", "..")).toThrow();
    expect(productWorkspaceDir("/tmp/kp-root", "ok-slug")).toContain("ok-slug");
  });

  it("hardDeleteProduct 对穿越 slug rejects 且不产生任何写入", async () => {
    const root = await mkdtemp(join(tmpdir(), "kp-slugguard-"));
    const before = await readdir(root);
    await expect(hardDeleteProduct(root, "..")).rejects.toThrow();
    const after = await readdir(root);
    expect(after).toEqual(before);
    await rm(root, { recursive: true, force: true });
  });
});