export type GateClearedBy = "human" | "agent" | "machine" | "unknown";
export type GateDurationTier = "short" | "medium" | "long";
export interface GateClearRecord {
  by: GateClearedBy;
  via: string;
  durationTier?: GateDurationTier;
}
export interface GateLedgerEntry {
  gate: string;
  what: string;
  openedAt: number;
  closedAt: number;
  durationMs: number;
  by: GateClearedBy;
  via: string;
  durationTier?: GateDurationTier;
  planGate: boolean;
}

export function parseDurationTier(value: unknown): GateDurationTier | undefined {
  return value === "short" || value === "medium" || value === "long" ? value : undefined;
}
