import { describe, it, expect } from "vitest";
import { summarizeAxe, type AxeViolation } from "../src/verify/a11y-summary.js";

describe("summarizeAxe", () => {
  it("按 impact 聚合四级计数", () => {
    const violations: AxeViolation[] = [
      { id: "a", impact: "critical" },
      { id: "b", impact: "critical" },
      { id: "c", impact: "serious" },
      { id: "d", impact: "moderate" },
      { id: "e", impact: "moderate" },
      { id: "f", impact: "moderate" },
      { id: "g", impact: "minor" },
    ];
    expect(summarizeAxe(violations)).toEqual({
      critical: 2,
      serious: 1,
      moderate: 3,
      minor: 1,
      gateable: false,
    });
  });

  it("空列表 → 全 0 且 gateable", () => {
    expect(summarizeAxe([])).toEqual({
      critical: 0,
      serious: 0,
      moderate: 0,
      minor: 0,
      gateable: true,
    });
  });

  it("缺省 impact 不计入任何一级、不报错", () => {
    const violations: AxeViolation[] = [
      { id: "a" },
      { id: "b", impact: "moderate" },
    ];
    expect(summarizeAxe(violations)).toEqual({
      critical: 0,
      serious: 0,
      moderate: 1,
      minor: 0,
      gateable: true,
    });
  });

  it("未知 impact 值被忽略，不污染计数", () => {
    const violations: AxeViolation[] = [{ id: "a", impact: "cosmetic" }];
    expect(summarizeAxe(violations)).toEqual({
      critical: 0,
      serious: 0,
      moderate: 0,
      minor: 0,
      gateable: true,
    });
  });

  it("仅 critical 存在 → 不可门", () => {
    expect(summarizeAxe([{ id: "a", impact: "critical" }]).gateable).toBe(false);
  });

  it("仅 serious 存在 → 不可门", () => {
    expect(summarizeAxe([{ id: "a", impact: "serious" }]).gateable).toBe(false);
  });

  it("仅 moderate/minor → 可门（gateable 为 true）", () => {
    const violations: AxeViolation[] = [
      { id: "a", impact: "moderate" },
      { id: "b", impact: "minor" },
    ];
    expect(summarizeAxe(violations).gateable).toBe(true);
  });
});
