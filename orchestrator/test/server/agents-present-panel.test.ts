import { describe, it, expect } from "vitest";
import { renderAgentsPresentPanel } from "../../src/server/ui/views/overview.js";

describe("renderAgentsPresentPanel", () => {
  it("列出在场 agent 的 instance/task/项目", () => {
    const html = renderAgentsPresentPanel([
      { instance: "acct-iso-chat", projectId: "kunpeng", worktree: "/k", task: "建注册机制", ts: 1 },
    ], 1_000_000_000);
    expect(html).toContain("acct-iso-chat");
    expect(html).toContain("建注册机制");
    expect(html).toContain("kunpeng");
  });
  it("空 → 最近 30 分钟无 agent 活动提示", () => {
    const html = renderAgentsPresentPanel([], 1_000_000_000);
    expect(html).toContain("最近 30 分钟无 agent 活动");
    expect(html).not.toContain("无在场");
  });
});
