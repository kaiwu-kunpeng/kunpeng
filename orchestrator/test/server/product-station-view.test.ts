import { describe, it, expect } from "vitest";
import { renderProductStationLine } from "../../src/server/ui/views/project.js";

type LoopArg = Parameters<typeof renderProductStationLine>[0];

function baseLoop(overrides: Record<string, unknown> = {}): LoopArg {
  return {
    slug: "demo",
    title: "演示",
    currentStage: "BUILD",
    stages: {},
    ...overrides,
  } as unknown as LoopArg;
}

describe("renderProductStationLine", () => {
  it("无预览：显示起预览按钮，不显示重跑 QA", () => {
    const html = renderProductStationLine(baseLoop());
    expect(html).toContain("product-preview-start");
    expect(html).not.toContain("product-qa-run");
    expect(html).toContain("product-publish");
  });
  it("预览活着：显示停预览 + 重跑 QA + 预览链接", () => {
    const html = renderProductStationLine(baseLoop({ preview: { alive: true, url: "http://localhost:5001" } }));
    expect(html).toContain("product-preview-stop");
    expect(html).toContain("product-qa-run");
    expect(html).toContain("http://localhost:5001");
  });
  it("已发布：保留发布态与链接，不再显示发布按钮", () => {
    const html = renderProductStationLine(baseLoop({ publish: { channel: "local", url: "http://localhost:5002", publishedAt: 1 } }));
    expect(html).toContain("已发布(本地)");
    expect(html).toContain("http://localhost:5002");
    expect(html).not.toContain('data-action="product-publish"');
  });
  it("QA 失败：问题数可见", () => {
    const html = renderProductStationLine(baseLoop({ qa: { ok: false, problems: ["p1", "p2"] } }));
    expect(html).toContain("QA 问题 2");
  });
  it("null loop 返回空串", () => {
    expect(renderProductStationLine(null as unknown as LoopArg)).toBe("");
  });
});