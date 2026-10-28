import { clientSource } from "../helpers/client-source.js";
import { httpSource } from "../helpers/http-source.js";
import { describe, it, expect } from "vitest";
import { renderVersionSpine } from "../../src/server/ui/views/project.js";
import type { DashboardState } from "../../src/server/state.js";

function stateWith(loopOver: Record<string, unknown>): DashboardState {
  return {
    productSelected: "demo",
    productCheckpoints: [],
    productSession: {
      status: "done",
      idea: "demo",
      answeredCount: 0,
      totalQuestions: 5,
      loop: { slug: "demo", currentStage: "build", stages: {}, ...loopOver },
    },
  } as unknown as DashboardState;
}

describe("版本脊柱·代码版本", () => {
  it("有 workspaceVersions → 代码版本区与恢复按钮在场", () => {
    const html = renderVersionSpine(stateWith({
      workspaceVersions: [
        { sha: "abcdef1234567890", message: "QA 通过", at: 5 },
        { sha: "1234567890abcdef", message: "手动存档", at: 3 },
      ],
    }));
    expect(html).toContain("ws-versions");
    expect(html).toContain("abcdef12");
    expect(html).toContain("QA 通过");
    expect(html).toContain('data-action="product-ws-restore"');
    expect(html).toContain('data-sha="abcdef1234567890"');
  });

  it("无 workspaceVersions → 不出代码版本区，既有脊柱不受影响", () => {
    const html = renderVersionSpine(stateWith({}));
    expect(html.includes("ws-versions")).toBe(false);
    expect(html).toContain("存档");
  });

  it("源级：client 分支与 ws-restore 端点已接", () => {
    expect(clientSource()).toContain("product-ws-restore");
    expect(httpSource()).toContain("/api/product/ws-restore");
  });
});
