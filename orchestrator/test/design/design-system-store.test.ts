import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  mergeOverride,
  readMaster,
  renderMasterMd,
  resolveDesignSystem,
  seedFromAdvice,
  writeMaster,
  writePageOverride,
  type DesignSystem,
} from "../../src/design/design-system-store.js";
import { searchDesignKnowledge } from "../../src/design/knowledge.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kunpeng-design-system-store-"));
}

test("seeds a design system from searchDesignKnowledge advice", () => {
  const ds = seedFromAdvice(searchDesignKnowledge("美妆水疗 优雅"));

  expect(ds.style).toContain("柔和");
  expect(ds.palette?.primary).toBe("#E8B4B8");
  expect(ds.fonts?.serif).toBe("Cormorant Garamond");
  expect(ds.antiPatterns).toHaveLength(9);
});

test("mergeOverride replaces page fields and unions anti-patterns", () => {
  const master: DesignSystem = {
    style: "master-style",
    palette: { primary: "A1", secondary: "A2", cta: "A3" },
    fonts: { serif: "Master Serif", sans: "Master Sans" },
    antiPatterns: ["禁默认字体", "禁卡片套卡片"],
  };
  const overridePalette = { primary: "B1", secondary: "B2", cta: "B3" };

  const merged = mergeOverride(master, {
    palette: overridePalette,
    antiPatterns: ["禁默认字体", "额外"],
  });

  expect(merged.palette).toBe(overridePalette);
  expect(merged.style).toBe("master-style");
  expect(merged.fonts).toEqual(master.fonts);
  expect(merged.antiPatterns).toEqual(["禁默认字体", "禁卡片套卡片", "额外"]);
});

test("renderMasterMd includes title, anti-pattern section, and one bullet per anti-pattern", () => {
  const ds: DesignSystem = {
    style: "柔和 UI Soft UI",
    palette: { primary: "#E8B4B8", secondary: "#A8D5BA", cta: "#D4AF37" },
    fonts: { serif: "Cormorant Garamond", sans: "Montserrat" },
    antiPatterns: ["禁默认字体", "禁卡片套卡片"],
    notes: "跨页面一致",
  };

  const md = renderMasterMd(ds);

  expect(md).toContain("# 设计系统 MASTER");
  expect(md).toContain("## 反模式(必避)");
  expect(md).toContain("- 禁默认字体");
  expect(md).toContain("- 禁卡片套卡片");
  expect(md.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(ds.antiPatterns.length);
});

test("reads and writes master plus page overrides with real IO", async () => {
  const dir = await tempDir();
  const slug = "beauty-spa";
  const master: DesignSystem = {
    style: "柔和 UI Soft UI",
    palette: { primary: "#E8B4B8", secondary: "#A8D5BA", cta: "#D4AF37" },
    fonts: { serif: "Cormorant Garamond", sans: "Montserrat" },
    antiPatterns: ["禁默认字体", "禁卡片套卡片"],
    notes: "全局规范",
  };
  const pagePalette = { primary: "#111111", secondary: "#222222", cta: "#333333" };

  await writeMaster(dir, slug, master);
  await writePageOverride(dir, slug, "home", {
    palette: pagePalette,
    antiPatterns: ["禁默认字体", "额外"],
    notes: "首页覆盖",
  });

  await expect(readMaster(dir, slug)).resolves.toEqual(master);
  await expect(resolveDesignSystem(dir, slug)).resolves.toEqual(master);
  await expect(resolveDesignSystem(dir, "missing")).resolves.toBeNull();
  await expect(resolveDesignSystem(dir, slug, "missing-page")).resolves.toEqual(master);
  await expect(resolveDesignSystem(dir, slug, "home")).resolves.toEqual({
    ...master,
    palette: pagePalette,
    antiPatterns: ["禁默认字体", "禁卡片套卡片", "额外"],
    notes: "首页覆盖",
  });

  const masterMd = await readFile(join(dir, slug, "MASTER.md"), "utf8");
  expect(masterMd).toContain("柔和 UI Soft UI");
});
