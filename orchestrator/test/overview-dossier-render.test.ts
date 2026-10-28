import { describe, it, expect } from "vitest";
import { renderStrategyPanel, renderDossierPanel } from "../src/server/ui/views/overview.js";
import type { DossierOverview } from "../src/server/dossier-state.js";

const full: DossierOverview = {
  project: { northStar: "流占比北极星", goals: "稳定+补产物", roadmap: { now: "干NOW", next: "干NEXT", later: "干LATER" } },
  changelog: { categories: [{ name: "Added", items: ["新功能甲", "新功能乙"] }], total: 2 },
  adrs: [{ num: "0006", title: "鉴权决策", status: "Accepted", date: "2026-06-20" }],
  specFamilies: [{ family: "cockpit", count: 13, files: [] }, { family: "loop", count: 17, files: [] }],
  specTotal: 283,
  ostNorthStar: undefined,
};

describe("renderStrategyPanel", () => {
  it("有数据→渲染北极星/目标/roadmap", () => {
    const h = renderStrategyPanel(full);
    expect(h).toContain("流占比北极星");
    expect(h).toContain("稳定+补产物");
    expect(h).toContain("干NOW"); expect(h).toContain("干NEXT"); expect(h).toContain("干LATER");
    expect(h).toContain("战略");
  });

  it("空→给生成提示", () => {
    const h = renderStrategyPanel(undefined);
    expect(h).toContain("kunpeng dossier");
    const h2 = renderStrategyPanel({ project: { northStar: "", goals: "", roadmap: { now: "", next: "", later: "" } }, changelog: { categories: [], total: 0 }, adrs: [], specFamilies: [], specTotal: 0 } satisfies NonNullable<Parameters<typeof renderStrategyPanel>[0]>);
    expect(h2).toContain("未生成");
  });
});

describe("renderDossierPanel", () => {
  it("渲染变更/决策/特性族", () => {
    const h = renderDossierPanel(full);
    expect(h).toContain("新功能甲");
    expect(h).toContain("ADR-0006");
    expect(h).toContain("鉴权决策");
    expect(h).toContain("cockpit");
    expect(h).toContain("×13");
    expect(h).toContain("283");
  });

  it("全空→空串(不占位)", () => {
    expect(renderDossierPanel(undefined)).toBe("");
    expect(renderDossierPanel({ changelog: { categories: [], total: 0 }, adrs: [], specFamilies: [], specTotal: 0, project: { northStar: "", goals: "", roadmap: { now: "", next: "", later: "" } } })).toBe("");
  });
});
