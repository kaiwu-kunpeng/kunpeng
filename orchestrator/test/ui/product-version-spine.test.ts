import { describe, it, expect } from "vitest";
import { renderVersionSpine } from "../../src/server/ui/views/project.js";
import type { DashboardState } from "../../src/server/state.js";

function base(): DashboardState {
  return {} as unknown as DashboardState;
}

function withProduct(checkpoints: unknown[]): DashboardState {
  const s = base() as unknown as Record<string, unknown>;
  s.productSelected = "demo-app";
  s.productCheckpoints = checkpoints;
  return s as unknown as DashboardState;
}

describe("产品版本脊柱（dyad 式只加不减）", () => {
  it("未选产品 → 空串", () => {
    expect(renderVersionSpine(base())).toBe("");
  });

  it("有检查点 → 版本行带 label/阶段中文短标/恢复按钮(不改 data-action 词汇)", () => {
    const html = renderVersionSpine(withProduct([
      { id: "1700000000000", ts: 1700000000000, label: "接受spec前自动存", stage: "spec" },
      { id: "1700000000001", ts: 1700000000001, label: "手动存档" },
    ]));
    expect(html).toContain("version-spine");
    expect(html).toContain("接受spec前自动存");
    expect(html).toContain("规格");
    expect(html).toContain('data-action="product-rollback"');
    expect(html).toContain('data-id="1700000000000"');
    expect(html).toContain('data-slug="demo-app"');
    expect(html).toContain('data-action="product-snapshot"');
    expect(html).toContain("只加不减");
  });

  it("零检查点 → 仍有存档按钮与「暂无版本」", () => {
    const html = renderVersionSpine(withProduct([]));
    expect(html).toContain('data-action="product-snapshot"');
    expect(html).toContain("暂无版本");
  });

  it("无内联硬编码颜色", () => {
    const html = renderVersionSpine(withProduct([{ id: "1", ts: 1, label: "x", stage: "build" }]));
    expect(/style="[^"]*#/.test(html)).toBe(false);
  });
});