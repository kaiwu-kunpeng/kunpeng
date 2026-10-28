import { describe, it, expect } from "vitest";
import { themeCss } from "../../src/server/ui/theme.js";

describe("扶摇双皮「曦/渊」锁值", () => {
  const dark = themeCss.slice(themeCss.indexOf('html[data-theme="dark"]'));
  const light = themeCss.slice(0, themeCss.indexOf('html[data-theme="dark"]'));

  it("日皮「暖曦」：Warm Dawn v2", () => {
    expect(light).toContain("--bg:#FFF8F2");
    expect(light).toContain("--ink:#1E1B17");
    expect(light).toContain("--primary:#8D4B00");
    expect(light).toContain("--line:#E8E1DB");
    expect(light).toContain("--warn:#B45309");
  });

  it("夜皮「渊」：渊蓝黑 + 亮渊青 + 曦金", () => {
    expect(dark).toContain("--bg:#0B1220");
    expect(dark).toContain("--card:#111A2C");
    expect(dark).toContain("--primary:#22B8D4");
    expect(dark).toContain("--warn:#F59E0B");
    expect(dark).toContain("--ink:#E6EDF6");
  });

  it("旧皮值已清场：不再有 Slate 日底/暖棕夜底/橙主色", () => {
    expect(themeCss).not.toContain("--bg:#F8FAFC");
    expect(themeCss).not.toContain("--bg:#14110C");
    expect(themeCss).not.toContain("--primary:#EA580C");
    expect(themeCss).not.toContain("--primary:#F97316");
    expect(themeCss).not.toContain("--bg:#FBF9F4");
    expect(themeCss).not.toContain("--primary:#155E75");
    expect(themeCss).not.toContain("--ink:#101825");
    expect(themeCss).not.toContain("--warn:#F0A836");
  });

  it("排印与动效 token 就位", () => {
    expect(themeCss).toContain("tabular-nums");
    expect(themeCss).toContain("--t-fast:");
    expect(themeCss).toContain("--t-panel:");
  });
});
