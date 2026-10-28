import type { ResearchFinding } from "./types.js";

const NO_SOURCE_REASON = "无可信来源 url（防编造来源）";

export function validateFindings(findings: ResearchFinding[]): {
  valid: ResearchFinding[];
  rejected: { finding: ResearchFinding; reason: string }[];
} {
  const valid: ResearchFinding[] = [];
  const rejected: { finding: ResearchFinding; reason: string }[] = [];

  for (const finding of findings) {
    if (typeof finding.source === "string" && finding.source.startsWith("http")) {
      valid.push(finding);
    } else {
      rejected.push({ finding, reason: NO_SOURCE_REASON });
    }
  }

  return { valid, rejected };
}
