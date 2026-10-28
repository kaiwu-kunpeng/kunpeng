import { describe, it, expect } from "vitest";
import { buildSolutionsOverview } from "../../src/server/state.js";
import { renderSolutions } from "../../src/server/ui/views/solutions.js";

describe("buildSolutionsOverview", () => {
  it("映射 playbookCount 并按 id 排序", () => {
    const out = buildSolutionsOverview([
      { id: "b", name: "方案B", description: "描述B", playbookFiles: ["p1.md", "p2.md"] },
      { id: "a", name: "方案A", playbookFiles: [] },
    ]);
    expect(out.map((s) => s.id)).toEqual(["a", "b"]);
    expect(out[0]).toEqual({ id: "a", name: "方案A", description: "", playbookCount: 0 });
    expect(out[1]).toEqual({ id: "b", name: "方案B", description: "描述B", playbookCount: 2 });
  });

  it("空安全", () => {
    expect(buildSolutionsOverview([])).toEqual([]);
  });
});

describe("renderSolutions", () => {
  it("渲染方案卡:名称/id/playbook 数 + 怎么用引导", () => {
    const catalog = buildSolutionsOverview([{ id: "geo-kit", name: "GEO 套件", description: "一键铺 GEO 监控", playbookFiles: ["a.md", "b.md", "c.md"] }]);
    const html = renderSolutions({ solutionCatalog: catalog } as never);
    expect(html).toContain("GEO 套件");
    expect(html).toContain("geo-kit");
    expect(html).toContain("3");
    expect(html).toContain('data-guide="solutions"');
    expect(html).toContain("kunpeng solution save");
  });

  it("空态给存方案提示 + 仍有引导", () => {
    const html = renderSolutions({ solutionCatalog: [] } as never);
    expect(html).toContain("kunpeng solution save");
    expect(html).toContain('data-guide="solutions"');
  });
});