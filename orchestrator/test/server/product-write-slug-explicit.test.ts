import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const routeSrc = readFileSync(join(srcDir, "server", "routes", "product-build.ts"), "utf8");
const viewSrc = readFileSync(join(srcDir, "server", "ui", "views", "project.ts"), "utf8");
const clientSrc = readFileSync(join(srcDir, "server", "ui", "client-parts", "part07.ts"), "utf8");

describe("写端点以显式 slug 为准", () => {
  it("路由按「body.slug 优先、活跃访谈兜底」解析", () => {
    expect(routeSrc).toContain("body.slug");
    const rule = /String\(body\.slug \?\? ""\)\.trim\(\) \|\| productSlug\(session\.idea\)/;
    expect(rule.test(routeSrc), "未见「显式优先、活跃兜底」的解析规则").toBe(true);
  });

  it("spec 保存前会存检查点", () => {
    const saveIdx = routeSrc.indexOf("/api/product/spec/save");
    expect(saveIdx).toBeGreaterThan(-1);
    const block = routeSrc.slice(saveIdx, saveIdx + 1400);
    expect(block).toContain("snapshot");
    expect(block.indexOf("snapshot")).toBeLessThan(block.indexOf("writeSpec"));
  });
});

describe("前端把选中的 slug 传上去", () => {
  it("spec-save 分支带 slug", () => {
    const idx = clientSrc.indexOf("product-spec-save");
    expect(idx).toBeGreaterThan(-1);
    expect(clientSrc.slice(idx, idx + 600)).toContain("slug");
  });

  it("accept 分支带 slug", () => {
    const idx = clientSrc.indexOf('action === "product-accept"');
    expect(idx).toBeGreaterThan(-1);
    expect(clientSrc.slice(idx, idx + 600)).toContain("slug");
  });

  it("design-run 分支带 slug", () => {
    const idx = clientSrc.indexOf("product-design-run");
    expect(idx).toBeGreaterThan(-1);
    expect(clientSrc.slice(idx, idx + 700)).toContain("slug");
  });
});

describe("按钮渲染带 data-slug", () => {
  it("spec-save 按钮带 data-slug", () => {
    const idx = viewSrc.indexOf("product-spec-save");
    expect(idx).toBeGreaterThan(-1);
    expect(viewSrc.slice(Math.max(0, idx - 200), idx + 200)).toContain("data-slug");
  });

  it("accept 按钮带 data-slug", () => {
    const idx = viewSrc.indexOf('data-action="product-accept"');
    expect(idx).toBeGreaterThan(-1);
    expect(viewSrc.slice(Math.max(0, idx - 200), idx + 260)).toContain("data-slug");
  });
});