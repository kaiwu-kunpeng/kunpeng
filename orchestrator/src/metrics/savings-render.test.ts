import { describe, expect, it } from "vitest";
import { renderSavingsV2 } from "./savings-render.js";
import type { SavingsV2 } from "./time-saved.js";

function fixture(): SavingsV2 {
  return {
    v1: {
      flows: 10, devFlows: 8, maintenanceFlows: 1, dataOpsFlows: 1,
      verifiedDevFlows: 7, humanEstimateHours: 9.5, loopActualHours: 2.1,
      netSavedHours: 7.4, loopTokensUsed: 123456,
    },
    assumptions: { humanEquivMinutes: { simple: 25, complex: 90 }, source: "default" },
    maintenanceTaxHours: 1.5,
    netAfterMaintenanceHours: 5.9,
    loopTokensUsed: 123456,
  } as SavingsV2;
}

describe("renderSavingsV2", () => {
  it("五要素齐:旧口径/扣维护税后/维护税/人工当量/loop tokens", () => {
    const text = renderSavingsV2(fixture()).join("\n");
    expect(text).toContain("旧口径");
    expect(text).toContain("7.4");
    expect(text).toContain("扣维护税后");
    expect(text).toContain("5.9");
    expect(text).toContain("维护税");
    expect(text).toContain("1.5");
    expect(text).toContain("人工当量");
    expect(text).toContain("默认");
    expect(text).toContain("loop tokens");
    expect(text).toContain("123456");
  });

  it("env 覆盖时标注 env覆盖", () => {
    const f = fixture();
    f.assumptions = { humanEquivMinutes: { simple: 10, complex: 40 }, source: "env" };
    expect(renderSavingsV2(f).join("\n")).toContain("env覆盖");
  });
});