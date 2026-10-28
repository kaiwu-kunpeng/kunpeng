import { expect, test } from "vitest";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listDesignPresets, loadDesignPreset, readDesignPresetIndex } from "../../src/design/design-presets.js";

// 只用中性预设（minimal / editorial）断言：交付包会剔除品牌命名的预设（R17），本测试随包交付也必须成立。
const rootDir = join(process.cwd(), "src", "design", "vendor", "design-systems");

test("readDesignPresetIndex 读取 vendored index，校验 schema/count/source", async () => {
  const index = await readDesignPresetIndex({ rootDir });

  expect(index.schema).toBe("kunpeng-design-presets/v1");
  expect(index.count).toBeGreaterThanOrEqual(60);
  expect(index.presets).toHaveLength(index.count);
  expect(index.source.repo).toBe("nexu-io/open-design");
  expect(index.source.license).toBe("Apache-2.0");
});

test("listDesignPresets 返回 index 中的摘要副本，包含分类与中文可用性", async () => {
  const presets = await listDesignPresets({ rootDir });
  const minimal = presets.find((preset) => preset.id === "minimal");
  const editorial = presets.find((preset) => preset.id === "editorial");

  expect(minimal).toMatchObject({
    id: "minimal",
    name: "Minimal",
    category: "Modern & Minimal",
    hasZh: false,
  });
  expect(editorial).toMatchObject({ id: "editorial", name: "Editorial", category: "Creative & Artistic" });

  presets[0].name = "mutated by caller";
  const reread = await listDesignPresets({ rootDir });
  expect(reread[0].name).not.toBe("mutated by caller");
});

test("loadDesignPreset 读取 DESIGN、tokens.css、design-tokens.json 与 manifest", async () => {
  const preset = await loadDesignPreset("editorial", { rootDir });
  const tokens = preset.designTokens as { tokens?: Array<{ name: string; value: string }> };

  expect(preset.id).toBe("editorial");
  expect(preset.manifest.files.design).toBe("DESIGN.md");
  expect(preset.designMd).toContain("Design System Inspired by Editorial");
  expect(preset.tokensCss).toContain("--accent: #9a5a2f");
  expect(tokens.tokens?.some((token) => token.name === "--accent" && token.value === "#9a5a2f")).toBe(true);
  expect(preset.seedHex).toBe("#9a5a2f");
});

test("loadDesignPreset preferZh 使用中文稿，同时保留英文与中文字段边界", async () => {
  // 中性预设都没有中文稿，用临时目录造一个带 DESIGN-zh.md 的索引项。
  const dir = join(mkdtempSync(join(tmpdir(), "kp-presets-zh-")), "ds");
  cpSync(join(rootDir, "minimal"), join(dir, "minimal"), { recursive: true });
  const index = JSON.parse(readFileSync(join(rootDir, "index.json"), "utf8")) as {
    presets: Array<{ id: string; hasZh: boolean }>;
  };
  const summary = { ...index.presets.find((p) => p.id === "minimal")!, hasZh: true };
  writeFileSync(join(dir, "index.json"), JSON.stringify({ ...index, count: 1, presets: [summary] }));
  writeFileSync(join(dir, "minimal", "DESIGN-zh.md"), "# 极简设计系统\n");

  const english = await loadDesignPreset("minimal", { rootDir: dir });
  const zh = await loadDesignPreset("minimal", { rootDir: dir, preferZh: true });

  expect(english.designMd).toContain("Design System Inspired by Minimal");
  expect(zh.designZhMd).toContain("极简设计系统");
  expect(zh.designMd).toBe(zh.designZhMd);
  expect(zh.designMd).not.toBe(english.designMd);
});

test("loadDesignPreset 对未知 id 与路径穿越 fail-closed", async () => {
  await expect(loadDesignPreset("not-a-real-preset", { rootDir })).rejects.toThrow(/unknown preset/);
  await expect(loadDesignPreset("../minimal", { rootDir })).rejects.toThrow(/invalid preset id/);
});