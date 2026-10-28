import { basename } from "node:path";

export type StateObjectKind = "flow" | "ledger" | "baseline" | "unknown";

export interface StateObjectClassification {
  kind: StateObjectKind;
  isFlow: boolean;
  known: boolean;
}

export const KNOWN_NON_FLOW_STATE_FILES: Readonly<Record<string, StateObjectKind>> = {
  "maintenance-ledger.json": "ledger",
  "fitness-baseline.json": "baseline",
  "product-kpi-baseline.json": "baseline",
};

export function classifyStateObject(
  filePath: string,
  parsed?: unknown,
): StateObjectClassification {
  if (
    parsed !== null
    && typeof parsed === "object"
    && !Array.isArray(parsed)
    && typeof (parsed as Record<string, unknown>).flowId === "string"
  ) {
    return { kind: "flow", isFlow: true, known: true };
  }

  const knownKind = KNOWN_NON_FLOW_STATE_FILES[basename(filePath)];
  if (knownKind !== undefined) {
    return { kind: knownKind, isFlow: false, known: true };
  }

  return { kind: "unknown", isFlow: false, known: false };
}

export function shouldWarnAboutStateFile(filePath: string, parsed?: unknown): boolean {
  return !classifyStateObject(filePath, parsed).known;
}
