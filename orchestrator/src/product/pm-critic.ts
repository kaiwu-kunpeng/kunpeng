import type { ProductDefinition } from "./contract.js";

export type CritiqueSeverity = "block" | "warn";
export type CritiqueVerdict = "pass" | "revise" | "block";

export interface CritiqueFinding {
  severity: CritiqueSeverity;
  category: string;
  issue: string;
  suggestion: string;
}

export interface PmCritique {
  findings: CritiqueFinding[];
  verdict: CritiqueVerdict;
  requiresHumanGate: boolean;
}

function hasNonEmptyItems(items: readonly string[] | undefined): boolean {
  return Array.isArray(items) && items.some((item) => item.trim() !== "");
}

function hasContent(value: string | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function decideVerdict(findings: readonly CritiqueFinding[]): CritiqueVerdict {
  if (findings.some((finding) => finding.severity === "block")) {
    return "block";
  }

  if (findings.some((finding) => finding.severity === "warn")) {
    return "revise";
  }

  return "pass";
}

export function critiqueDefinition(def: ProductDefinition): PmCritique {
  const findings: CritiqueFinding[] = [];

  if (!hasNonEmptyItems(def.nonGoals)) {
    findings.push({
      severity: "warn",
      category: "non-goals",
      issue: "未声明 Non-Goals，容易在实现中镀金或扩大范围。",
      suggestion: "明确声明不做什么，提前挡住范围蔓延。",
    });
  }

  if (!hasNonEmptyItems(def.acceptance)) {
    findings.push({
      severity: "block",
      category: "acceptance",
      issue: "缺少验收标准，无验收即无契约。",
      suggestion: "补充可客观判定的验收标准后再进入实现。",
    });
  }

  if (def.stories.length > 7) {
    findings.push({
      severity: "warn",
      category: "scope-creep",
      issue: "用户故事过多，当前定义可能已经范围蔓延。",
      suggestion: "先切出 Walking Skeleton 顶层切片，把非关键故事延后。",
    });
  }

  if (def.users.length > 5) {
    findings.push({
      severity: "warn",
      category: "focus",
      issue: "目标用户过宽，定位不聚焦。",
      suggestion: "收敛到最先服务的核心用户群，避免同时满足所有人。",
    });
  }

  if (def.stories.length >= 3 && def.acceptance.length <= 1) {
    findings.push({
      severity: "warn",
      category: "priority",
      issue: "故事多但验收单一，全是 P0 = 没有 P0，未真正分级。",
      suggestion: "按最关键用户进展拆出优先级，并让验收契约覆盖核心故事。",
    });
  }

  if (!hasContent(def.jobStatement)) {
    findings.push({
      severity: "warn",
      category: "jtbd",
      issue: "缺少 JTBD/job statement，难以判断真实用户进展。",
      suggestion: "补足“当...时，需要...以便...”形式的 job statement。",
    });
  }

  const verdict = decideVerdict(findings);

  return {
    findings,
    verdict,
    requiresHumanGate: verdict !== "pass",
  };
}

export function buildCritiquePrompt(def: ProductDefinition): string {
  return [
    "你是资深 PM 红队审查者，请对下面的 ProductDefinition 做战略层对抗评审。",
    "重点寻找隐形 PRD、虚荣指标、缺 Alternatives、最显然指标、范围蔓延、目标用户过宽、验收契约不足和排序失真。",
    "只输出单行 JSON，格式为 {\"findings\":[{\"severity\":\"block|warn\",\"category\":\"...\",\"issue\":\"...\",\"suggestion\":\"...\"}],\"verdict\":\"pass|revise|block\"}。",
    `ProductDefinition: ${JSON.stringify(def)}`,
  ].join("\n");
}
