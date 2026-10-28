import { describe, it, expect } from "vitest";
import { renderSolutions } from "../../src/server/ui/views/solutions.js";
import type { DashboardState } from "../../src/server/state-types.js";
import { clientScript } from "../../src/server/ui/client.js";

function legacyState(solutions: DashboardState["solutions"]): Pick<DashboardState, "solutionCatalog" | "solutions"> {
  return { solutionCatalog: undefined, solutions };
}

describe("方案库视图", () => {
  it("空态给 solution save 指引", () => {
    const html = renderSolutions(legacyState({ templates: [], projects: [] }));
    expect(html).toContain("还没有方案模板");
    expect(html).toContain("solution save");
  });

  it("模板卡:计数/已装/未装项目的装入按钮", () => {
    const html = renderSolutions(legacyState({
      templates: [{ id: "geo-v1", name: "GEO方案", playbookCount: 2, loopCount: 1, installed: ["p1"] }],
      projects: [{ id: "p1", name: "项目一" }, { id: "p2", name: "项目二" }],
    }));
    expect(html).toContain("GEO方案");
    expect(html).toContain("2 张卡");
    expect(html).toContain("1 个 loop");
    expect(html).toContain("<code>项目一</code>");
    expect(html).toContain('data-solution-apply="geo-v1"');
    expect(html).toContain('data-project="p2"');
    expect(html).not.toContain('data-project="p1"');
  });

  it("XSS:模板名与项目名被转义", () => {
    const html = renderSolutions(legacyState({
      templates: [{ id: "x", name: "<script>bad()</script>", playbookCount: 0, loopCount: 0, installed: [] }],
      projects: [{ id: "p", name: "<img src=x>" }],
    }));
    expect(html).not.toContain("<script>bad()</script>");
    expect(html).not.toContain("<img src=x>");
  });

  it("client 接线:装入按钮打 /api/solutions/apply 且模板串安全", () => {
    expect(clientScript).toContain("data-solution-apply");
    expect(clientScript).toContain('"/api/solutions/apply"');
    expect(clientScript.includes("`")).toBe(false);
  });
});