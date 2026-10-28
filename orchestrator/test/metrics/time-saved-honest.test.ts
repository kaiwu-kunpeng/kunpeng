import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  aggregateSavings, aggregateSavingsLegacy, flowKind, flowSaving, resolveComplexity, savingsV2, HUMAN_EQUIV_MINUTES,
} from "../../src/metrics/time-saved.js";
import { renderSavingsV2 } from "../../src/metrics/savings-render.js";

const devHistory = [{ stage: "spec", at: 0 }, { stage: "implement", at: 2 * 60000 }, { stage: "verify", at: 5 * 60000 }];
const LONG = [{ stage: "spec", at: 0 }, { stage: "implement", at: 60000 }, { stage: "verify", at: 999 * 60000 }];

describe("尺子诚实化（作者锁定）", () => {
  test("净省可以为负：下限没了；旧口径函数仍保留下限", () => {
    const f = { status: "verified", requirement: "小改", history: LONG };
    expect(flowSaving(f).netSavedMin).toBe(HUMAN_EQUIV_MINUTES.simple - 999);
    expect(aggregateSavings([f]).netSavedHours).toBeCloseTo((HUMAN_EQUIV_MINUTES.simple - 999) / 60, 1);
    expect(aggregateSavings([f]).negativeFlows).toBe(1);
    expect(aggregateSavingsLegacy([f]).netSavedHours).toBe(0);
  });

  test("复杂度来源：changedFileCount > predictedFiles > 文本；文本判定标 text", () => {
    expect(resolveComplexity({ status: "verified", requirement: "x", changedFileCount: 1, predictedFiles: ["a", "b", "c"] })).toEqual({ complexity: "simple", source: "changedFiles" });
    expect(resolveComplexity({ status: "verified", requirement: "x", changedFileCount: 4 })).toEqual({ complexity: "complex", source: "changedFiles" });
    expect(resolveComplexity({ status: "verified", requirement: "x", predictedFiles: ["a", "b"] })).toEqual({ complexity: "complex", source: "predictedFiles" });
    expect(resolveComplexity({ status: "verified", requirement: "x", predictedFiles: ["a"] })).toEqual({ complexity: "simple", source: "predictedFiles" });
    expect(resolveComplexity({ status: "verified", requirement: "重构整体架构，迁移多个模块，端到端重写" }).source).toBe("text");
    expect(flowSaving({ status: "verified", requirement: "x", history: devHistory, changedFileCount: 3 }).complexity).toBe("complex");
  });

  test("data-ops 判定只看 implement：有 verify 没 implement 仍是 data-ops", () => {
    expect(flowKind({ status: "verified", requirement: "SPARK_PLUG", history: [{ stage: "spec", at: 0 }, { stage: "verify", at: 60000 }] })).toBe("data-ops");
    expect(flowKind({ status: "verified", requirement: "x", history: [{ stage: "spec", at: 0 }, { stage: "review", at: 1 }, { stage: "repair", at: 2 }] })).toBe("data-ops");
    expect(aggregateSavings([{ status: "verified", requirement: "SPARK_PLUG", history: [{ stage: "spec", at: 0 }, { stage: "verify", at: 60000 }] }]).dataOpsFlows).toBe(1);
  });

  test("origin=guardian 即维护流，不靠需求文本前缀", () => {
    expect(flowKind({ status: "verified", requirement: "普通需求", history: devHistory, origin: "guardian" })).toBe("maintenance");
    expect(flowKind({ status: "verified", requirement: "普通需求", history: devHistory })).toBe("dev");
  });

  test("plan 子流折成一个顶层单位：估时求和、跨度求和、全 verified 才算", () => {
    const children = [
      { flowId: "p-a", planId: "plan-x", status: "verified", requirement: "子任务 a", history: devHistory, predictedFiles: ["a"] },
      { flowId: "p-b", planId: "plan-x", status: "verified", requirement: "子任务 b", history: devHistory, predictedFiles: ["b"] },
    ];
    const parent = { flowId: "plan-x", planId: "plan-x", status: "verified", requirement: "方案集成 plan-x", history: [{ stage: "spec", at: 0 }] };
    const standalone = { flowId: "solo", status: "verified", requirement: "独立流", history: devHistory };
    const r = aggregateSavings([...children, parent, standalone]);
    expect(r.flows).toBe(4);
    expect(r.planGroups).toBe(1);
    expect(r.topLevelFlows).toBe(2);
    expect(r.verifiedDevFlows).toBe(2);
    expect(r.dataOpsFlows).toBe(0);
    expect(Math.round(r.humanEstimateHours * 10) / 10).toBe(Math.round(((3 * HUMAN_EQUIV_MINUTES.simple) / 60) * 10) / 10);
    expect(Math.round(r.loopActualHours * 10) / 10).toBe(Math.round((15 / 60) * 10) / 10);
    expect(r.complexityBySource).toEqual({ changedFiles: 0, predictedFiles: 2, text: 1 });
    const broken = aggregateSavings([children[0], { ...children[1], status: "rolled-back" }, parent]);
    expect(broken.verifiedDevFlows).toBe(0);
    expect(broken.topLevelFlows).toBe(1);
    expect(aggregateSavingsLegacy([...children, parent, standalone]).verifiedDevFlows).toBe(3);
  });

  test("环境变量覆盖当量 → 标记进报表；默认口径没有标记行", () => {
    const flows = [{ status: "verified", requirement: "x", history: devHistory }];
    const env = savingsV2(flows, { env: { KUNPENG_HUMAN_EQUIV_SIMPLE: "10", KUNPENG_HUMAN_EQUIV_COMPLEX: "40" } });
    expect(env.assumptionsFlag).toContain("环境变量");
    expect(renderSavingsV2(env).join("\n")).toContain("审计");
    const def = savingsV2(flows, { env: {} });
    expect(def.assumptionsFlag).toBeUndefined();
    const text = renderSavingsV2(def).join("\n");
    expect(text).not.toContain("审计");
    expect(text).toContain("顶层单位");
    expect(text).toContain("复杂度来源");
    expect(text).toContain("净省为负");
  });

  test("savings 命令带 --compare-legacy 与环境变量审计行", () => {
    const src = readFileSync(fileURLToPath(new URL("../../src/cli-commands/reports.ts", import.meta.url)), "utf8");
    expect(src).toContain("--compare-legacy");
    expect(src).toContain("aggregateSavingsLegacy(");
    expect(src).toContain("savings-assumptions.jsonl");
    expect(src).toContain("C5");
  });
});