import type { Finding, Severity } from "../loop/guardian.js";
import type { ProjectChecks } from "../project/detect.js";

export interface ReinjectTask {
  fingerprint: string;
  requirement: string;
  source: string;
  severity: Severity;
}

export const GUARDIAN_REINJECT_PREFIX = "修复守护扫描发现的问题";

const SEVERITY_RANK: Record<Severity, number> = { info: 0, warn: 1, error: 2 };

function normalizeMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ");
}

export function stableHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

export function findingToTask(f: Finding): ReinjectTask {
  const message = normalizeMessage(f.message);
  const key = `${f.scanner}|${f.file ?? ""}|${message}`;
  return {
    fingerprint: stableHash(key),
    source: `guardian:${f.scanner}`,
    severity: f.severity,
    requirement: `${GUARDIAN_REINJECT_PREFIX}（${f.scanner}/${f.severity}）：${f.file ?? "?"}:${f.line ?? "?"} ${message}。只改代码消除该问题，不要改验收命令。`,
  };
}

export function isGuardianReinjectRequirement(requirement: string): boolean {
  return requirement.startsWith(GUARDIAN_REINJECT_PREFIX);
}

export function findingsToTasks(findings: Finding[], opts?: { minSeverity?: Severity }): ReinjectTask[] {
  const min = SEVERITY_RANK[opts?.minSeverity ?? "error"];
  const seen = new Set<string>();
  const out: ReinjectTask[] = [];
  for (const f of findings) {
    if (SEVERITY_RANK[f.severity] < min) continue;
    // No-location findings are eslint summary/banner/path-line noise, not actionable backlog tasks.
    if (f.file == null || f.line == null) continue;
    const t = findingToTask(f);
    if (seen.has(t.fingerprint)) continue;
    seen.add(t.fingerprint);
    out.push(t);
  }
  return out;
}

export function acceptanceCmdForSource(source: string, detected: ProjectChecks): string | undefined {
  const scanner = source.startsWith("guardian:") ? source.slice("guardian:".length) : "";
  if (scanner === "lint") return detected.lint;
  if (scanner === "typecheck") return detected.typecheck;
  if (scanner === "build") return detected.build;
  return undefined;
}
