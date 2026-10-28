import { isRecord } from "../util/is-record.js";

export interface AuditFixable {
  pkg: string;
  severity: string;
  fixable: boolean;
  fixName?: string;
  fixVersion?: string;
  isMajor?: boolean;
}

export interface FixPlan {
  total: number;
  safeAuto: AuditFixable[];
  majorReview: AuditFixable[];
  unfixable: AuditFixable[];
  bySeverity: Record<string, number>;
}

function parseFixAvailable(pkg: string, severity: string, fixAvailable: unknown): AuditFixable {
  if (!isRecord(fixAvailable)) {
    return {
      pkg,
      severity,
      fixable: fixAvailable !== false && fixAvailable != null,
    };
  }

  return {
    pkg,
    severity,
    fixable: true,
    ...(typeof fixAvailable.name === "string" ? { fixName: fixAvailable.name } : {}),
    ...(typeof fixAvailable.version === "string" ? { fixVersion: fixAvailable.version } : {}),
    isMajor: Boolean(fixAvailable.isSemVerMajor),
  };
}

export function parseAuditFixables(auditJson: string): AuditFixable[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(auditJson);
  } catch {
    return [];
  }

  if (!isRecord(parsed) || !isRecord(parsed.vulnerabilities)) {
    return [];
  }

  return Object.entries(parsed.vulnerabilities).map(([key, value]) => {
    const vulnerability = isRecord(value) ? value : {};
    const pkg = typeof vulnerability.name === "string" ? vulnerability.name : key;
    const severity = typeof vulnerability.severity === "string" ? vulnerability.severity : "unknown";

    return parseFixAvailable(pkg, severity, vulnerability.fixAvailable);
  });
}

export function buildFixPlan(fixables: AuditFixable[]): FixPlan {
  const safeAuto: AuditFixable[] = [];
  const majorReview: AuditFixable[] = [];
  const unfixable: AuditFixable[] = [];
  const bySeverity: Record<string, number> = {};

  for (const fixable of fixables) {
    bySeverity[fixable.severity] = (bySeverity[fixable.severity] ?? 0) + 1;

    if (!fixable.fixable) {
      unfixable.push(fixable);
    } else if (fixable.isMajor === true) {
      majorReview.push(fixable);
    } else {
      safeAuto.push(fixable);
    }
  }

  return {
    total: fixables.length,
    safeAuto,
    majorReview,
    unfixable,
    bySeverity,
  };
}
