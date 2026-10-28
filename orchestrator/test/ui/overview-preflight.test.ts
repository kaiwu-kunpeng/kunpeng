import { describe, it, expect } from "vitest";
import { renderOverview } from "../../src/server/ui/views/overview.js";
import type { DashboardState } from "../../src/server/state.js";

function base(): DashboardState {
  return {} as unknown as DashboardState;
}

describe("总览前置条件横幅", () => {
  it("有未通过项 → 渲染横幅并列出 label 与 hint", () => {
    const s = base();
    (s as { preflight?: unknown }).preflight = [
      { key: "claude-auth", label: "Claude CLI 登录", ok: false, hint: "终端运行 claude 后 /login" },
      { key: "tmux", label: "tmux（终端会话复活）", ok: true, hint: "brew install tmux" },
    ];
    const html = renderOverview(s);
    expect(html).toContain("preflight-banner");
    expect(html).toContain("Claude CLI 登录");
    expect(html).toContain("/login");
    expect(html.includes("brew install tmux")).toBe(false);
  });

  it("全绿或缺失 → 完全不渲染横幅", () => {
    const s1 = base();
    (s1 as { preflight?: unknown }).preflight = [
      { key: "claude-auth", label: "Claude CLI 登录", ok: true, hint: "x" },
    ];
    expect(renderOverview(s1).includes("preflight-banner")).toBe(false);
    expect(renderOverview(base()).includes("preflight-banner")).toBe(false);
  });
});