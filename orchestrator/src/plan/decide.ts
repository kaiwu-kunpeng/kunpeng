/** 可插拔的「窄题判断」接口（System-One 式：给定状态回答一道有限选项的题，附依据）。
 *  本仓只实现确定性后端（C8）；LLM / Jev 这类模型后端只留接口不实现——中文弱、外发、可注入，且结论只能推动 L0–L1（C5）。 */
export interface Decider<S, C extends string> {
  readonly id: string;
  decide(state: S): { choice: C; basis: string[] };
}

export type SpecRiskTier = "低" | "中" | "高";

/** 2026-09-24 用鲲鹏历史流离线标定（1,208 条 spec 形态真实流，剔除 plan 壳流）：各档实际回滚率。 */
export const SPEC_RISK_CALIBRATION: Readonly<Record<SpecRiskTier, number>> = { 低: 0.044, 中: 0.096, 高: 0.197 };

export interface SpecRiskFeatures {
  /** 既无 scope 块也无锁定测试（历史回滚率 29.2%，对照 spec 形态 6.6%）。 */
  noSpecShape: boolean;
  allowCount: number;
  testAllowCount: number;
  lineCount: number;
}

export function specRiskFeatures(spec: string): SpecRiskFeatures {
  const fence = "`".repeat(3);
  return {
    noSpecShape: !spec.includes(`${fence}scope`) && !spec.includes(`${fence}accept-file`) && !spec.includes(`${fence}ts path=`),
    allowCount: (spec.match(/^allow:\s/gm) ?? []).length,
    testAllowCount: (spec.match(/^allow:\s+\S*test\S*/gm) ?? []).length,
    lineCount: spec.split("\n").length,
  };
}

/** 计分：无 spec 形态 +3、allow ≥ 7 条 +2（历史 18.9%）、allow 里测试路径 ≥ 2 个 +1（13.4%）、spec ≥ 150 行 +1（13.7%）。
 *  ≥3 高、1–2 中、0 低。锁定测试有无、accept 是否带 env -u 在历史数据里没有区分度，不计分。 */
export const specRiskDecider: Decider<string, SpecRiskTier> = {
  id: "spec-risk-v1-deterministic",
  decide(spec) {
    const f = specRiskFeatures(spec);
    const basis: string[] = [];
    let score = 0;
    if (f.noSpecShape) { score += 3; basis.push("没有 scope 块也没有锁定测试"); }
    if (f.allowCount >= 7) { score += 2; basis.push(`scope allow ${f.allowCount} 条（≥7）`); }
    if (f.testAllowCount >= 2) { score += 1; basis.push(`要改 ${f.testAllowCount} 个测试路径`); }
    if (f.lineCount >= 150) { score += 1; basis.push(`spec ${f.lineCount} 行（≥150）`); }
    const choice: SpecRiskTier = score >= 3 ? "高" : score >= 1 ? "中" : "低";
    return { choice, basis };
  },
};

/** spec-lint 的一行提示文案。 */
export function describeSpecRisk(spec: string): string {
  const { choice, basis } = specRiskDecider.decide(spec);
  const rate = (SPEC_RISK_CALIBRATION[choice] * 100).toFixed(1);
  return `回滚风险：${choice}（历史同档回滚率 ${rate}%${basis.length ? `；依据：${basis.join("、")}` : ""}）`;
}
