// 两层门总决策（纯函数）——把 Tier-1 各确定性信号汇总成一个放行/拦截/待人审的结论。
// 纯决策：只读布尔信号、输出结论，不读文件、不跑命令、无副作用（宪法 C8）。
// 核心研究依据：新基线只有人能批——视觉基线若新增/改动，确定性手段无法判断它是
// 「合理的设计更新」还是「回归」，故不计硬拦，而是升级到人审（needsHumanReview）。

export interface TierGateInput {
  buildPassed: boolean;
  behaviorPassed: boolean;
  a11yGateable: boolean;
  perfWithinBudget: boolean;
  visualMatchesBaseline: boolean;
  hasNewOrChangedBaseline: boolean;
}

export interface TierGateResult {
  tier1AutoPass: boolean;
  needsHumanReview: boolean;
  blockers: string[];
}

export function twoTierDecision(i: TierGateInput): TierGateResult {
  const blockers: string[] = [];

  if (!i.buildPassed) blockers.push("build 失败");
  if (!i.behaviorPassed) blockers.push("行为测试失败");
  if (!i.a11yGateable) blockers.push("a11y 不可门");
  if (!i.perfWithinBudget) blockers.push("性能超预算");
  // 视觉：仅当「无新/改基线 + 不匹配」才算硬拦。有新/改基线 = 待人批，不算回归。
  if (!i.hasNewOrChangedBaseline && !i.visualMatchesBaseline) {
    blockers.push("视觉与基线不符");
  }

  const tier1Clean = blockers.length === 0;
  const tier1AutoPass = tier1Clean && !i.hasNewOrChangedBaseline;
  const needsHumanReview = tier1Clean && i.hasNewOrChangedBaseline;

  return { tier1AutoPass, needsHumanReview, blockers };
}
