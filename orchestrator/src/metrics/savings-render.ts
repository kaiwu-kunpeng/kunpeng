import type { SavingsV2 } from "./time-saved.js";

export function renderSavingsV2(v2: SavingsV2): string[] {
  const assumptionSource = v2.assumptions.source === "env" ? "env覆盖" : "默认";
  return [
    `  v2 旧口径: ${v2.v1.netSavedHours} 工程小时`,
    `  v2 扣维护税后: ${v2.netAfterMaintenanceHours} 工程小时`,
    `  v2 维护税: ${v2.maintenanceTaxHours} 工程小时`,
    `  v2 人工当量: ${assumptionSource} simple ${v2.assumptions.humanEquivMinutes.simple}min / complex ${v2.assumptions.humanEquivMinutes.complex}min`,
    `  v2 loop tokens: ${v2.loopTokensUsed}`,
    `  v2 顶层单位: ${v2.v1.topLevelFlows ?? 0}（plan 组 ${v2.v1.planGroups ?? 0}）｜净省为负: ${v2.v1.negativeFlows ?? 0}`,
    `  v2 复杂度来源: changedFiles ${v2.v1.complexityBySource?.changedFiles ?? 0} / predictedFiles ${v2.v1.complexityBySource?.predictedFiles ?? 0} / text ${v2.v1.complexityBySource?.text ?? 0}（text 为低置信）`,
    ...(v2.assumptionsFlag ? [`  v2 ⚠ ${v2.assumptionsFlag}`] : []),
  ];
}
