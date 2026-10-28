import { describe, it, expect } from "vitest";
import { hasScopeBlock, auditScope } from "../../src/loop/scope-audit.js";

describe("hasScopeBlock", () => {
  it("识别含 allow: 行的 scope 块", () => {
    const text = "# spec\n```scope\nallow: src/a.ts\nallow: test/a.test.ts\n```\n正文";
    expect(hasScopeBlock(text)).toBe(true);
  });
  it("无 scope 块返回 false", () => {
    expect(hasScopeBlock("# spec\n只有正文，没有围栏块")).toBe(false);
  });
  it("空 scope 块（无 allow 行）返回 false", () => {
    expect(hasScopeBlock("```scope\n\n```")).toBe(false);
  });
});

describe("auditScope", () => {
  it("spec 或 requirement 任一含 scope 块即 strong", () => {
    const withScope = "```scope\nallow: src/x.ts\n```";
    expect(auditScope(withScope, "无").strong).toBe(true);
    expect(auditScope("无", withScope).strong).toBe(true);
  });
  it("两边都缺时 strong=false 且 reason 说明缺 scope", () => {
    const verdict = auditScope("no block here", "也没有");
    expect(verdict.strong).toBe(false);
    expect(verdict.reason).toContain("scope");
  });
});