import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { loadExternalRecipes } from "../../src/loop/recipe-loader.js";

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "kp-recipes-"));
  const ok = join(root, "good");
  mkdirSync(ok);
  writeFileSync(join(ok, "index.js"), "globalThis.__kpRecipeLoaded = (globalThis.__kpRecipeLoaded ?? 0) + 1;\n");
  const bad = join(root, "broken");
  mkdirSync(bad);
  writeFileSync(join(bad, "index.js"), "throw new Error('boom');\n");
  mkdirSync(join(root, "no-entry"));
  return root;
}

describe("外置 recipe 加载器", () => {
  it("加载子目录下的 index.js,并让模块自身完成注册", async () => {
    const before = (globalThis as { __kpRecipeLoaded?: number }).__kpRecipeLoaded ?? 0;
    const res = await loadExternalRecipes([fixture()]);
    expect(res.loaded.length).toBe(1);
    expect((globalThis as { __kpRecipeLoaded?: number }).__kpRecipeLoaded).toBe(before + 1);
  });

  it("模块抛错只记 failed,不影响其它模块,也不抛出", async () => {
    const res = await loadExternalRecipes([fixture()]);
    expect(res.failed.length).toBe(1);
    expect(res.failed[0].error).toContain("boom");
    expect(res.loaded.length).toBe(1);
  });

  it("目录不存在时静默跳过,返回空结果", async () => {
    const res = await loadExternalRecipes([join(tmpdir(), "kp-recipes-does-not-exist-xyz")]);
    expect(res.loaded).toEqual([]);
    expect(res.failed).toEqual([]);
  });

  it("没有 index.js 的子目录被忽略", async () => {
    const res = await loadExternalRecipes([fixture()]);
    expect(res.loaded.every((p) => !p.includes("no-entry"))).toBe(true);
  });

  it("driver.ts 不再出现任何客户名硬编码", () => {
    const src = readFileSync(new URL("../../src/loop/driver.ts", import.meta.url), "utf8");
    expect(src.toLowerCase()).not.toContain(["part", "zeal"].join(""));
  });

  it("通用的 IndexNow 提交器已归位到中立模块", async () => {
    const mod = await import("../../src/seo/indexnow.js");
    expect(typeof mod.submitIndexNow).toBe("function");
  });
});
