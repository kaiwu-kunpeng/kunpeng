import { describe, expect, test } from "vitest";
import { renderStrategyPanel } from "../../src/server/ui/views/overview.js";

describe("renderStrategyPanel: 北极星下展示净省工时", () => {
  const dossier = {
    project: { northStar: "每月净省工程时间", goals: "", roadmap: { now: "", next: "", later: "" } },
  } as never;
  const savings = {
    flows: 100, topLevelFlows: 100, planGroups: 0, negativeFlows: 0,
    complexityBySource: { changedFiles: 0, predictedFiles: 0, text: 100 }, loopTokensUsed: 0, devFlows: 60, maintenanceFlows: 5, dataOpsFlows: 35,
    verifiedDevFlows: 42, humanEstimateHours: 50, loopActualHours: 3, netSavedHours: 47,
  };

  test("传 savings → HTML 含净省工时、净省小时数、verified 工程流数", () => {
    const html = renderStrategyPanel(dossier, savings);
    expect(html).toContain("净省工时");
    expect(html).toContain("47");
    expect(html).toContain("42");
  });

  test("不传 savings → 不渲染净省行(向后兼容)", () => {
    const html = renderStrategyPanel(dossier);
    expect(html).not.toContain("净省工时");
  });
});