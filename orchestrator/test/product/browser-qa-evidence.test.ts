import { describe, it, expect } from "vitest";
import { qaVerdict } from "../../src/product/browser-qa.js";

const baseInput = {
  status: 200,
  bodyTextLength: 500,
  interactiveCount: 3,
  consoleErrors: [] as string[],
};

describe("浏览器 QA 网络与耗时证据", () => {
  it("networkFailures 每条计问题", () => {
    const v = qaVerdict({ ...baseInput, networkFailures: ["GET /api/x → 500", "GET /a.png → failed: net::ERR_FAILED"] });
    expect(v.ok).toBe(false);
    expect(v.problems.join("\n")).toContain("网络: GET /api/x → 500");
    expect(v.problems.filter((p) => p.startsWith("网络:"))).toHaveLength(2);
  });

  it("loadMs 超预算计问题，默认预算 10000ms", () => {
    const slow = qaVerdict({ ...baseInput, loadMs: 12000 });
    expect(slow.ok).toBe(false);
    expect(slow.problems.join()).toContain("加载超时");
    const fast = qaVerdict({ ...baseInput, loadMs: 800 });
    expect(fast.ok).toBe(true);
  });

  it("自定义 loadBudgetMs 生效", () => {
    const v = qaVerdict({ ...baseInput, loadMs: 900, loadBudgetMs: 500 });
    expect(v.ok).toBe(false);
  });

  it("新字段缺失 → 行为与现状一致（不产生网络/耗时问题）", () => {
    const v = qaVerdict({ ...baseInput });
    expect(v.ok).toBe(true);
    expect(v.problems.some((p) => p.startsWith("网络:") || p.startsWith("加载超时"))).toBe(false);
  });
});