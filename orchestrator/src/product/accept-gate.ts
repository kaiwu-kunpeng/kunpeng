import type { ConcretenessResult } from "./concreteness.js";

export interface SpecAcceptanceDecision {
  allowed: boolean;
  overridden: boolean;
  blockedFields: string[];
  message?: string;
}

export function decideSpecAcceptance({
  concreteness,
  humanOverride,
}: {
  concreteness: Pick<ConcretenessResult, "pass" | "issues">;
  humanOverride: boolean;
}): SpecAcceptanceDecision {
  if (concreteness.pass) return { allowed: true, overridden: false, blockedFields: [] };

  const blockedFields = [...new Set(concreteness.issues.map((issue) => issue.field))];
  if (humanOverride) {
    return {
      allowed: true,
      overridden: true,
      blockedFields,
      message: `已人工覆盖具体性门：${blockedFields.join("、")}`,
    };
  }

  return {
    allowed: false,
    overridden: false,
    blockedFields,
    message: `具体性门未通过：${blockedFields.join("、")}`,
  };
}
