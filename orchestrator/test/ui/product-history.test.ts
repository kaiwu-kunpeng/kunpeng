import { clientSource } from "../helpers/client-source.js";
import { describe, it, expect } from "vitest";
import { renderVersionSpine } from "../../src/server/ui/views/project.js";
import type { DashboardState } from "../../src/server/state.js";

describe("renderVersionSpine", () => {
  it("有检查点 → 存档按钮 + 恢复按钮(带id) + 版本承诺", () => {
    const html = renderVersionSpine({
      productSelected: true,
      productCheckpoints: [{ id: "1000", ts: 1000, label: "存档1" }],
      productSession: { status: "done", idea: "p", answeredCount: 0, totalQuestions: 5, loop: { slug: "p", currentStage: "spec", stages: {} } },
    } as DashboardState);
    expect(html).toContain('data-action="product-snapshot"');
    expect(html).toContain('data-action="product-rollback"');
    expect(html).toContain('data-id="1000"');
    expect(html).toContain("存档1");
    expect(html).toContain("版本");
    expect(html).toContain("只加不减");
    expect(html).toContain("恢复");
  });
  it("未选产品(productSelected 缺失) → 空串", () => {
    expect(renderVersionSpine({} as DashboardState)).toBe("");
  });
  it("client 源码: snapshot/rollback 处理器 + 端点", () => {
    const src = clientSource();
    expect(src).toContain('action === "product-snapshot"');
    expect(src).toContain('action === "product-rollback"');
    expect(src).toContain("/api/product/snapshot");
    expect(src).toContain("/api/product/rollback");
  });
});
