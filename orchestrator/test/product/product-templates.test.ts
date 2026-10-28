import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRODUCT_TEMPLATES, templateById, mergeTemplateStories, templateConventionsBlock } from "../../src/product/product-templates.js";
import { startProductRun } from "../../src/product/loop-orchestrate.js";
import { readRegistry } from "../../src/product/registry.js";

const NOW = 1_800_000_000_000;

describe("PRODUCT_TEMPLATES", () => {
  it("七类齐全且 id 唯一", () => {
    const ids = PRODUCT_TEMPLATES.map((t) => t.id);
    expect(ids.slice().sort()).toEqual(["ai-agent", "crm", "dashboard", "form-workflow", "internal-tool", "landing-page", "saas"]);
    expect(new Set(ids).size).toBe(7);
  });
  it("每个模板有像样的种子", () => {
    for (const t of PRODUCT_TEMPLATES) {
      expect(t.label.length).toBeGreaterThan(1);
      expect(t.storySeeds.length).toBeGreaterThanOrEqual(3);
      expect(t.acceptanceSeeds.length).toBeGreaterThanOrEqual(2);
    }
  });
  it("每个模板有可执行技术约定", () => {
    for (const t of PRODUCT_TEMPLATES) {
      expect(t.conventions.length).toBeGreaterThanOrEqual(3);
      for (const convention of t.conventions) {
        expect(convention.trim()).not.toBe("");
        expect(convention).not.toContain("建议补一条约定");
      }
    }
  });
  it("templateConventionsBlock 输出 markdown 块", () => {
    expect(templateConventionsBlock(undefined)).toBe("");
    expect(templateConventionsBlock({ ...PRODUCT_TEMPLATES[0], conventions: [] })).toBe("");
    const block = templateConventionsBlock(templateById("saas"));
    expect(block).toContain("## 模板约定（必须遵守）");
    expect(block).toContain("- 多租户数据必须");
  });
  it("templateById 命中与落空", () => {
    expect(templateById("saas")?.id).toBe("saas");
    expect(templateById("nope")).toBeUndefined();
  });
});

describe("mergeTemplateStories", () => {
  it("去重合并且不改入参", () => {
    const t = templateById("landing-page")!;
    const def = { stories: ["自有故事", t.storySeeds[0]], acceptance: ["自有验收"] };
    const merged = mergeTemplateStories(def, t);
    expect(merged.stories[0]).toBe("自有故事");
    expect(merged.stories.filter((s) => s === t.storySeeds[0])).toHaveLength(1);
    expect(merged.stories.length).toBe(2 + t.storySeeds.length - 1);
    expect(merged.acceptance).toEqual(expect.arrayContaining(t.acceptanceSeeds));
    expect(def.stories).toHaveLength(2);
  });
});

describe("startProductRun 模板透传", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kp-tpl-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("template 存进产品档案", async () => {
    const r = await startProductRun(root, "带模板的产品", NOW, "dashboard");
    expect(r.product.template).toBe("dashboard");
    const reg = await readRegistry(root);
    expect(reg.products.find((p) => p.slug === r.product.slug)?.template).toBe("dashboard");
  });
  it("不带模板照旧", async () => {
    const r = await startProductRun(root, "普通产品", NOW);
    expect(r.product.template).toBeUndefined();
  });
});
