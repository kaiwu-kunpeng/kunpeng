import { isRecord } from "../util/is-record.js";
import type { SelfEvoFinding } from "./self-evo-finding.js";

export type AuditSeverity = "critical" | "high" | "moderate" | "low";

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function viaSummary(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;

  const items = value
    .map((item) => {
      if (typeof item === "string") return item;
      if (isRecord(item)) return stringValue(item.title) ?? stringValue(item.name) ?? stringValue(item.source);
      return undefined;
    })
    .filter((item): item is string => Boolean(item));

  if (items.length === 0) return undefined;
  return items.join(", ");
}

export function severityScore(severity: string): number {
  const normalized = severity.trim().toLowerCase();
  if (normalized === "critical") return 100;
  if (normalized === "high") return 80;
  if (normalized === "moderate") return 50;
  if (normalized === "low") return 20;
  return 10;
}

export function parseAuditFindings(auditJson: string): SelfEvoFinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(auditJson);
  } catch {
    return [];
  }

  if (!isRecord(parsed) || !isRecord(parsed.vulnerabilities)) return [];

  return Object.entries(parsed.vulnerabilities).map(([key, value]) => {
    const vulnerability = isRecord(value) ? value : {};
    const pkgName = stringValue(vulnerability.name) ?? key;
    const severity = stringValue(vulnerability.severity) ?? "unknown";
    const via = viaSummary(vulnerability.via);
    const detail = [
      `包名: ${pkgName}`,
      `严重度: ${severity}`,
      via ? `via: ${via}` : undefined,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");

    return {
      channel: "security",
      title: `依赖漏洞：${pkgName}（${severity}）`,
      detail,
      sources: [`npm-audit:${pkgName}`],
      evidenceState: "untested",
      score: severityScore(severity),
    };
  });
}
