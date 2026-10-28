import { describe, it, expect } from "vitest";
import { themeCss } from "../../src/server/ui/theme.js";

describe("视觉系统 token", () => {
  it("字阶 token 全量定义", () => {
    for (const t of ["--fs-xs", "--fs-sm", "--fs-base", "--fs-md", "--fs-lg", "--fs-xl"]) {
      expect(themeCss).toContain(`${t}:`);
    }
  });
  it("间距与圆角 token 定义", () => {
    for (const t of ["--sp-2", "--sp-4", "--r-sm", "--r-md", "--r-lg"]) {
      expect(themeCss).toContain(`${t}:`);
    }
  });
  it("卡片阴影日夜双值", () => {
    expect(themeCss).toContain("--shadow-card:");
    const dark = themeCss.slice(themeCss.indexOf('html[data-theme="dark"]'));
    expect(dark).toContain("--shadow-card:");
  });
  it("按钮有 focus-visible 可达性与按压反馈", () => {
    expect(themeCss).toContain("focus-visible");
    expect(themeCss).toContain("scale(.98)");
  });
  it("组件真的用上了 token（抽查）", () => {
    expect(themeCss).toContain("var(--fs-base)");
    expect(themeCss).toContain("var(--r-md)");
    expect(themeCss).toContain("var(--shadow-card)");
    expect(themeCss).toContain("var(--sp-3)");
  });
  it("8 个核心 token 契约未拆（冗余于 dual-skin，双保险）", () => {
    for (const t of ["--bg", "--card", "--ink", "--primary", "--warn", "--success", "--danger", "--line"]) {
      expect(themeCss).toContain(`${t}:`);
    }
  });
});