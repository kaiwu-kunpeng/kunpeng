import { describe, it, expect } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";

describe("客户端轮询瘦身", () => {
  it("轻量轮询函数就位且打到 /api/pills", () => {
    expect(clientScript).toContain("function pollPills");
    expect(clientScript).toContain('"/api/pills"');
    expect(clientScript).toContain("renderStatusPill");
  });

  it("定时器换轻量端点且页面隐藏暂停、回前台立刷", () => {
    expect(clientScript).toContain("setInterval(pollPills, 10000)");
    expect(clientScript).not.toContain("setInterval(function () { loadState().catch(function () {}); }, 6000)");
    expect(clientScript).toContain("visibilitychange");
    expect(clientScript).toContain("document.hidden");
  });

  it("路由切换只在无状态时才全量拉,全量 loadState 保留", () => {
    expect(clientScript).toContain("if (!latestState) await loadState()");
    expect(clientScript).toContain("async function loadState");
  });

  it("药丸渲染拆分后语义保留(在跑/待我处理文案不变)", () => {
    expect(clientScript).toContain("function renderStatusPill");
    expect(clientScript).toContain("在跑 ");
    expect(clientScript).toContain("待我处理 ");
  });

  it("模板串安全:无反引号", () => {
    expect(clientScript.includes("`")).toBe(false);
  });
});