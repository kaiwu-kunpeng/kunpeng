import { describe, it, expect } from "vitest";
import { themeCss } from "../../src/server/ui/theme.js";

describe("Warm Dawn v2 日皮换血", () => {
  it("新日值到位，旧日值退场", () => {
    expect(themeCss).toContain("--bg:#FFF8F2");
    expect(themeCss).toContain("--ink:#1E1B17");
    expect(themeCss).toContain("--primary:#8D4B00");
    expect(themeCss).toContain("--primary-soft:#FFDCC3");
    expect(themeCss).toContain("--line:#E8E1DB");
    expect(themeCss).toContain("--danger:#BA1A1A");
    expect(themeCss.includes("--bg:#FBF9F4")).toBe(false);
    expect(themeCss.includes("--primary:#155E75")).toBe(false);
    expect(themeCss.includes("--ink:#101825")).toBe(false);
  });

  it("Refined Dynamic 夜皮：核心不动，三处点睛", () => {
    expect(themeCss).toContain("--bg:#0B1220");
    expect(themeCss).toContain("--card:#111A2C");
    expect(themeCss).toContain("--primary:#22B8D4");
    expect(themeCss).toContain("--line:#1E2A40");
    expect(themeCss).toContain("--warn:#F59E0B");
    expect(themeCss).toContain("--muted:#94A3B8");
    expect(themeCss.includes("--warn:#F0A836")).toBe(false);
  });

  it("品牌资产恒定：logo/头像渊蓝渐变保留", () => {
    expect(themeCss).toContain("#22B8D4");
    expect(themeCss.split("linear-gradient(135deg,#155E75,#22B8D4)").length - 1).toBeGreaterThanOrEqual(1);
  });
});