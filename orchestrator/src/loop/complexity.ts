export type Complexity = "simple" | "complex";

export interface ComplexityVerdict {
  complexity: Complexity;
  score: number;
  reasons: string[];
}

const COMPLEX_KEYWORDS = [
  "重构",
  "迁移",
  "架构",
  "整体",
  "全面",
  "系统",
  "多个",
  "多文件",
  "端到端",
  "重写",
  "refactor",
  "migrate",
  "architecture",
  "redesign",
  "across",
  "multiple",
  "pipeline",
];

/**
 * 启发式分类。simple = 短、单点、无复杂关键词、无多子句堆叠；其余 complex。
 * opts.fileHint：调用方若已知涉及文件数，>1 直接判 complex。
 */
export function classifyComplexity(
  requirement: string,
  opts?: { fileHint?: number },
): ComplexityVerdict {
  const reasons: string[] = [];
  let score = 0;
  const text = (requirement ?? "").trim();
  const len = text.length;

  if (opts?.fileHint !== undefined && opts.fileHint > 1) {
    score += 3;
    reasons.push(`涉及 ${opts.fileHint} 个文件(>1)`);
  }

  if (len > 280) {
    score += 2;
    reasons.push(`需求较长(${len}字符>280)`);
  } else if (len > 140) {
    score += 1;
    reasons.push(`需求中等(${len}字符>140)`);
  }

  const lowerText = text.toLowerCase();
  const hits = COMPLEX_KEYWORDS.filter((keyword) =>
    lowerText.includes(keyword.toLowerCase()),
  );
  if (hits.length) {
    score += hits.length;
    reasons.push(`复杂关键词: ${hits.join("/")}`);
  }

  const clauses = text
    .split(/[，,；;。\n]|并且|然后/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  if (clauses.length >= 4) {
    score += 2;
    reasons.push(`多子句(${clauses.length}段)`);
  } else if (clauses.length === 3) {
    score += 1;
    reasons.push("三子句");
  }

  const complexity: Complexity = score >= 2 ? "complex" : "simple";
  if (complexity === "simple") {
    reasons.push("信号不足阈值→simple(可走快路径)");
  }

  return { complexity, score, reasons };
}
