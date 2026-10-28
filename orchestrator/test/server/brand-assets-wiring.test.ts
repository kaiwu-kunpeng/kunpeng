import { describe, it, expect } from "vitest";
import type { DashboardState } from "../../src/server/state-types.js";
import { LOGO_SVG, ICON_PNG_BASE64 } from "../../src/server/ui/brand-assets.js";
import { renderSidebar } from "../../src/server/ui/sidebar.js";
import { MANIFEST } from "../../src/server/pwa.js";
import { httpSource } from "../helpers/http-source.js";

describe("品牌资产接线", () => {
  it("资产模块本身完好：SVG 与三尺寸 PNG（真 PNG 签名）", () => {
    expect(LOGO_SVG).toContain("<svg");
    for (const size of [192, 512, 180] as const) {
      const buf = Buffer.from(ICON_PNG_BASE64[size], "base64");
      expect(buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `icon ${size} PNG 签名`).toBe(true);
      expect(buf.length).toBeGreaterThan(1000);
    }
  });

  it("侧栏用 LOGO_SVG 替换字形块，副题带「运营」（渲染产出）", () => {
    const html = renderSidebar({ humanGates: [], flows: [], artifacts: {} } as unknown as DashboardState, "overview");
    expect(html).toContain("<svg");
    expect(html).not.toContain('class="glyph"');
    expect(html).toContain("AI 研发与运营操作系统");
  });

  it("http 图标路由改用 base64 资产", () => {
    const src = httpSource();
    const idx = src.indexOf('"/icon-192.png"');
    expect(idx).toBeGreaterThan(-1);
    expect(src.slice(idx, idx + 800)).toContain("ICON_PNG_BASE64");
  });

  it("manifest 换新皮色与新定位语", () => {
    expect(MANIFEST.theme_color).toBe("#8D4B00");
    expect(MANIFEST.background_color).toBe("#FFF8F2");
    expect(MANIFEST.name).toContain("运营");
  });
});
