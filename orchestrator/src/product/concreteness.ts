import type { ProductDefinition } from "./contract.js";

export interface ConcretenessIssue {
  field: string;
  problem: string;
}

export interface ConcretenessResult {
  pass: boolean;
  score: number;
  issues: ConcretenessIssue[];
}

const BUZZWORDS = [
  "提升效率",
  "优化体验",
  "赋能",
  "无缝",
  "一站式",
  "打造闭环",
  "improve efficiency",
  "streamline",
  "seamless",
  "leverage",
  "synergy",
  "empower",
] as const;

function hasContent(value: string | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function hasNonEmptyItems(items: readonly string[] | undefined): boolean {
  return Array.isArray(items) && items.some((item) => item.trim() !== "");
}

function hasScenarioPhrase(text: string): boolean {
  return /当.+时/.test(text);
}

function hasBuzzwordWithoutSpecifics(problem: string): boolean {
  const normalized = problem.toLowerCase();
  return (
    BUZZWORDS.some((word) => normalized.includes(word.toLowerCase())) &&
    !/\d/.test(problem) &&
    !hasScenarioPhrase(problem)
  );
}

export function assessConcreteness(def: ProductDefinition): ConcretenessResult {
  const issues: ConcretenessIssue[] = [];
  const problem = typeof def.problem === "string" ? def.problem.trim() : "";

  if (problem.length < 12) {
    issues.push({ field: "problem", problem: "问题描述过短，需补充具体客户、场景或可观察痛点" });
  }

  if (hasBuzzwordWithoutSpecifics(problem)) {
    issues.push({ field: "problem", problem: "问题描述命中套话且缺少数字或“当…时”场景补充" });
  }

  if (!hasNonEmptyItems(def.users)) {
    issues.push({ field: "users", problem: "目标用户缺失，需明确真实客户或用户群体" });
  }

  if (!hasNonEmptyItems(def.stories)) {
    issues.push({ field: "stories", problem: "用户故事缺失，需补充具体使用场景" });
  }

  if (!hasNonEmptyItems(def.acceptance)) {
    issues.push({ field: "acceptance", problem: "验收标准缺失，需补充可客观判定的结果" });
  }

  if (!hasContent(def.jobStatement)) {
    issues.push({ field: "jobStatement", problem: "建议补 JTBD 句式，明确用户在什么情境下要完成什么进展" });
  }

  if (!hasNonEmptyItems(def.nonGoals)) {
    issues.push({ field: "nonGoals", problem: "未声明非目标，易范围蔓延/镀金" });
  }

  return {
    pass: issues.every((issue) => issue.field === "jobStatement" || issue.field === "nonGoals"),
    score: Math.round((1 - issues.length / 7) * 100),
    issues,
  };
}
