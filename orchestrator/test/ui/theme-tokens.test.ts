import { describe, it, expect } from "vitest";
import type { DashboardState } from "../../src/server/state-types.js";
import { renderShell } from "../../src/server/ui/shell.js";
import { themeCss } from "../../src/server/ui/theme.js";

describe("token v2 规整", () => {
  it("字号五档 + 新 token 到位", () => {
    expect(themeCss).toContain("--fs-base:14px");
    expect(themeCss).toContain("--fs-lg:20px");
    expect(themeCss).toContain("--sans:");
    expect(themeCss).toContain("--mono:");
    expect(themeCss).toContain("--ok:");
    expect(themeCss).toContain("--info:");
    expect(themeCss).toContain("--r-sm:6px");
    expect(themeCss).toContain(".num{font-variant-numeric:tabular-nums}");
  });

  it("双皮契约未拆：8 核心 token 日夜双定义", () => {
    for (const t of ["--bg", "--card", "--ink", "--primary", "--warn", "--success", "--danger", "--line"]) {
      const hits = themeCss.split(`${t}:`).length - 1;
      expect(hits, `${t} 应至少日夜各一次`).toBeGreaterThanOrEqual(2);
    }
    expect(themeCss).toContain('html[data-theme="dark"]');
  });

  it("品牌橙残留已清（图表色除外）", () => {
    const withoutCharts = themeCss.replace(/--ch-[a-z]+:[^;]+;/g, "");
    expect(withoutCharts.includes("#F97316")).toBe(false);
    expect(withoutCharts.includes("#FBBF24")).toBe(false);
    expect(themeCss.includes(".brand .glyph")).toBe(false);
  });

  it("药丸统一基线在场且靠后覆盖", () => {
    const idx = themeCss.indexOf("统一药丸基线");
    expect(idx).toBeGreaterThan(0);
    expect(themeCss.slice(idx)).toContain(".gate-pill");
    expect(themeCss.slice(idx)).toContain("font-size:var(--fs-xs)");
  });
});

describe("theme-color 对齐", () => {
  it("shell meta 与 manifest 一致（渲染产出）", () => {
    const html = renderShell({ humanGates: [], flows: [], artifacts: {} } as unknown as DashboardState);
    expect(html).toContain('name="theme-color" content="#8D4B00"');
    expect(html.includes("#111827")).toBe(false);
  });
});
