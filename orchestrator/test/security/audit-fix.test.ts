import { describe, it, expect } from "vitest";
import { parseAuditFixables, buildFixPlan } from "../../src/security/audit-fix.js";

const SAMPLE = JSON.stringify({
  vulnerabilities: {
    "esbuild": { name: "esbuild", severity: "moderate", fixAvailable: { name: "vitest", version: "4.1.9", isSemVerMajor: true } },
    "gray-matter": { name: "gray-matter", severity: "moderate", fixAvailable: { name: "gray-matter", version: "2.0.1", isSemVerMajor: false } },
    "lodash": { name: "lodash", severity: "high", fixAvailable: true },
    "leftpad": { name: "leftpad", severity: "low", fixAvailable: false },
  },
});

describe("parseAuditFixables", () => {
  it("抽包名/严重度/可修复性(对象/true/false 三态)", () => {
    const fx = parseAuditFixables(SAMPLE);
    expect(fx).toHaveLength(4);
    const eb = fx.find((f) => f.pkg === "esbuild")!;
    expect(eb).toMatchObject({ severity: "moderate", fixable: true, fixName: "vitest", fixVersion: "4.1.9", isMajor: true });
    const gm = fx.find((f) => f.pkg === "gray-matter")!;
    expect(gm).toMatchObject({ fixable: true, isMajor: false });
    const lo = fx.find((f) => f.pkg === "lodash")!;
    expect(lo.fixable).toBe(true);
    expect(lo.isMajor).toBeUndefined();
    const lp = fx.find((f) => f.pkg === "leftpad")!;
    expect(lp.fixable).toBe(false);
  });

  it("坏 JSON / 无 vulnerabilities → 空数组", () => {
    expect(parseAuditFixables("not json")).toEqual([]);
    expect(parseAuditFixables(JSON.stringify({ foo: 1 }))).toEqual([]);
  });
});

describe("buildFixPlan", () => {
  it("分桶:非major可自动 / major需审 / 不可修 + 严重度计数", () => {
    const plan = buildFixPlan(parseAuditFixables(SAMPLE));
    expect(plan.total).toBe(4);
    // gray-matter(非major) + lodash(true,无isMajor) = safeAuto
    expect(plan.safeAuto.map((f) => f.pkg).sort()).toEqual(["gray-matter", "lodash"]);
    // esbuild(major) = majorReview
    expect(plan.majorReview.map((f) => f.pkg)).toEqual(["esbuild"]);
    // leftpad = unfixable
    expect(plan.unfixable.map((f) => f.pkg)).toEqual(["leftpad"]);
    expect(plan.bySeverity).toMatchObject({ moderate: 2, high: 1, low: 1 });
  });

  it("空输入 → 全空桶", () => {
    const plan = buildFixPlan([]);
    expect(plan.total).toBe(0);
    expect(plan.safeAuto).toEqual([]);
    expect(plan.majorReview).toEqual([]);
    expect(plan.unfixable).toEqual([]);
  });
});