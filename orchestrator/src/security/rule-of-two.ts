export interface ActionContext {
  untrustedInput: boolean;
  sensitiveAccess: boolean;
  externalEgress: boolean;
}

export interface RuleOfTwoVerdict {
  count: number;
  dimensions: string[];
  safe: boolean;
  requiresHumanGate: boolean;
  reason: string;
}

const DIMENSIONS: Array<keyof ActionContext> = ["untrustedInput", "sensitiveAccess", "externalEgress"];

function describeDimensions(dimensions: string[]): string {
  return dimensions.length > 0 ? dimensions.join("+") : "无";
}

export function ruleOfTwo(ctx: ActionContext): RuleOfTwoVerdict {
  const dimensions = DIMENSIONS.filter((dimension) => ctx[dimension]);
  const count = dimensions.length;
  const safe = count <= 2;
  const requiresHumanGate = count >= 3;
  const occupied = describeDimensions(dimensions);
  const reason = requiresHumanGate
    ? `三项危险属性全占（${occupied}）：越过 Rule of Two 边界，强制人工门`
    : `占 ${count}/3 项（${occupied}），在 Rule of Two 边界内`;

  return {
    count,
    dimensions,
    safe,
    requiresHumanGate,
    reason,
  };
}

export function chatRuleOfTwo(input: {
  mode: "plan" | "act";
  explicitAct: boolean;
  web: boolean;
  uploads: number;
}): { mode: "plan" | "act"; downgraded: boolean; verdict: RuleOfTwoVerdict } {
  const verdict = ruleOfTwo({
    untrustedInput: input.web || input.uploads > 0,
    sensitiveAccess: true,
    externalEgress: input.mode === "act",
  });
  if (verdict.requiresHumanGate && !input.explicitAct) {
    return { mode: "plan", downgraded: true, verdict };
  }
  return { mode: input.mode, downgraded: false, verdict };
}
