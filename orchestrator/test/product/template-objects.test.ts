import { describe, it, expect } from "vitest";
import { PRODUCT_TEMPLATES, templateObjectsBlock } from "../../src/product/product-templates.js";
import { httpSource } from "../helpers/http-source.js";

describe("模板业务对象模型", () => {
  it("七模板全部带 ≥2 个对象，对象有具体字段和视图", () => {
    expect(PRODUCT_TEMPLATES.length).toBeGreaterThanOrEqual(7);
    for (const t of PRODUCT_TEMPLATES) {
      expect(t.objects && t.objects.length >= 2, `${t.id} 缺 objects`).toBe(true);
      for (const o of t.objects ?? []) {
        expect(o.name.length).toBeGreaterThan(0);
        expect(o.fields.length).toBeGreaterThanOrEqual(4);
        expect(o.views.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("七模板全部带保守 QA 脚本种子，首步 goto /", () => {
    for (const t of PRODUCT_TEMPLATES) {
      const seed = t.qaScriptSeed ?? [];
      expect(seed.length >= 2, `${t.id} 缺 qaScriptSeed`).toBe(true);
      expect(seed[0]).toEqual({ action: "goto", target: "/" });
      for (const s of seed) {
        expect(["goto", "expectText", "expectSelector"]).toContain(s.action);
      }
    }
  });

  it("templateObjectsBlock：空模板返回空串，实模板含对象名与字段", () => {
    expect(templateObjectsBlock(undefined)).toBe("");
    expect(templateObjectsBlock({ ...PRODUCT_TEMPLATES[0], objects: [] })).toBe("");
    const crm = PRODUCT_TEMPLATES.find((t) => t.id === "crm");
    const block = templateObjectsBlock(crm);
    expect(block).toContain("业务对象模型");
    for (const o of crm?.objects ?? []) {
      expect(block).toContain(o.name);
      expect(block).toContain(o.fields[0]);
    }
  });

  it("源级：http.ts 已接对象块与种子落盘", () => {
    const src = httpSource();
    expect(src).toContain("templateObjectsBlock");
    expect(src).toContain("qa-script.json");
  });
});
