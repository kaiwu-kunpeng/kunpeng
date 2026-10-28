import { clientSource } from "./helpers/client-source.js";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { renderLibrary } from "../src/server/ui/views/library.js";

const uiDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "server", "ui");

describe("资料库页(作者验收)", () => {
  it("renderLibrary 输出过滤条+三类卡片+知识占位", () => {
    const html = renderLibrary({
      solutionCatalog: [{ id: "t1", name: "GEO 监控", description: "d" }] as never,
      docsCatalog: [{ name: "a.html", title: "决策稿A" }] as never,
      skillCatalog: [{ id: "s1", name: "tdd", description: "测试驱动" }] as never,
    });
    expect(html).toContain("data-lib-search");
    expect(html).toContain('data-lib-type="template"');
    expect(html).toContain('data-lib-kind="doc"');
    expect(html).toContain("决策稿A");
    expect(html).toContain("GEO 监控");
    expect(html).toContain("data-lib-captures");
    expect(html).toContain("#/knowledge");
  });

  it("空目录不炸且给空态", () => {
    const html = renderLibrary({} as never);
    expect(html).toContain("资料库");
  });

  it("侧栏收编:资料库入口存在,旧四入口移除", () => {
    const sidebar = readFileSync(join(uiDir, "sidebar.ts"), "utf8");
    expect(sidebar).toContain('#/library');
    expect(sidebar).not.toContain('"#/solutions"');
    expect(sidebar).not.toContain('"#/docs"');
    expect(sidebar).not.toContain('"#/knowledge"');
    expect(sidebar).not.toContain('"#/skills"');
  });

  it("render-view 接了 #/library;client 白名单含 #/library 且旧路由仍合法", () => {
    const rv = readFileSync(join(uiDir, "render-view.ts"), "utf8");
    expect(rv).toContain("renderLibrary");
    const client = clientSource();
    expect(client).toContain('#/library');
    expect(client).toContain('#/solutions');
    expect(client).toContain('/api/library?type=capture');
  });
});