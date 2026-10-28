import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface GateDecision {
  at: number;
  flowId: string;
  cmd: string;
  regressions: string[];
  verdict: "pass" | "fail";
}

const gateDecisionPath = (stateDir: string): string => join(stateDir, "gate-decisions.jsonl");

function isGateDecision(value: unknown): value is GateDecision {
  if (!value || typeof value !== "object") return false;
  const d = value as Partial<GateDecision>;
  return typeof d.at === "number"
    && typeof d.flowId === "string"
    && typeof d.cmd === "string"
    && Array.isArray(d.regressions)
    && d.regressions.every((item) => typeof item === "string")
    && (d.verdict === "pass" || d.verdict === "fail");
}

export function appendGateDecision(stateDir: string, d: GateDecision): void {
  try {
    appendFileSync(gateDecisionPath(stateDir), `${JSON.stringify(d)}\n`, "utf8");
  } catch {
    // Best-effort metric log only; verification flow must not depend on it.
  }
}

export function readGateDecisions(stateDir: string, limit?: number): GateDecision[] {
  try {
    const rows = readFileSync(gateDecisionPath(stateDir), "utf8")
      .split(/\r?\n/)
      .flatMap((line) => {
        if (!line.trim()) return [];
        try {
          const parsed = JSON.parse(line) as unknown;
          return isGateDecision(parsed) ? [parsed] : [];
        } catch {
          return [];
        }
      });
    return typeof limit === "number" && limit >= 0 ? rows.slice(-limit) : rows;
  } catch {
    return [];
  }
}
