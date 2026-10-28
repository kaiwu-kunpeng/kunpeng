import { isRecord } from "../util/is-record.js";

export interface AuditSummary {
  critical: number;
  high: number;
  moderate: number;
  low: number;
  total: number;
}

export interface FixProvenance {
  fixedAt: number;
  before: AuditSummary;
  after: AuditSummary;
  reduced: number;
  fixedPackages: string[];
  verified: boolean;
}

export interface BuildFixProvenanceInput {
  before: AuditSummary;
  after: AuditSummary;
  fixedPackages: string[];
  verified: boolean;
  fixedAt: number;
}

const ZERO_SUMMARY: AuditSummary = {
  critical: 0,
  high: 0,
  moderate: 0,
  low: 0,
  total: 0,
};

function numberOrZero(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

export function parseAuditSummary(auditJson: string): AuditSummary {
  let parsed: unknown;

  try {
    parsed = JSON.parse(auditJson);
  } catch {
    return { ...ZERO_SUMMARY };
  }

  if (!isRecord(parsed) || !isRecord(parsed.metadata) || !isRecord(parsed.metadata.vulnerabilities)) {
    return { ...ZERO_SUMMARY };
  }

  const vulnerabilities = parsed.metadata.vulnerabilities;

  // npm audit 的 metadata.vulnerabilities 是签名输入，缺项按 0 保守处理。
  return {
    critical: numberOrZero(vulnerabilities.critical),
    high: numberOrZero(vulnerabilities.high),
    moderate: numberOrZero(vulnerabilities.moderate),
    low: numberOrZero(vulnerabilities.low),
    total: numberOrZero(vulnerabilities.total),
  };
}

export function reductionOk(before: AuditSummary, after: AuditSummary): boolean {
  return after.total < before.total && after.critical <= before.critical && after.high <= before.high;
}

export function buildFixProvenance(input: BuildFixProvenanceInput): FixProvenance {
  return {
    fixedAt: input.fixedAt,
    before: input.before,
    after: input.after,
    reduced: input.before.total - input.after.total,
    fixedPackages: input.fixedPackages,
    verified: input.verified,
  };
}
