import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface MaintenanceEntry {
  id: string;
  at: string;
  what: string;
  minutes: number;
}

const LEDGER_FILE = "maintenance-ledger.json";

function ledgerPath(stateDir: string): string {
  return join(stateDir, LEDGER_FILE);
}

function randomSuffix(): string {
  return randomBytes(2).readUInt16BE(0).toString(36).padStart(4, "0").slice(-4);
}

function isMaintenanceEntry(value: unknown): value is MaintenanceEntry {
  if (typeof value !== "object" || value == null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.at === "string" &&
    typeof entry.what === "string" &&
    typeof entry.minutes === "number"
  );
}

function writeLedger(stateDir: string, entries: MaintenanceEntry[]): void {
  const file = ledgerPath(stateDir);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = join(dirname(file), `.${LEDGER_FILE}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
}

export function logMaintenance(stateDir: string, what: string, minutes: number): MaintenanceEntry {
  const entry: MaintenanceEntry = {
    id: `mnt-${Date.now().toString(36)}-${randomSuffix()}`,
    at: new Date().toISOString(),
    what,
    minutes,
  };
  writeLedger(stateDir, [...listMaintenance(stateDir), entry]);
  return entry;
}

export function listMaintenance(stateDir: string): MaintenanceEntry[] {
  const file = ledgerPath(stateDir);
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (!Array.isArray(parsed) || !parsed.every(isMaintenanceEntry)) {
    throw new Error(`Invalid maintenance ledger: ${file}`);
  }
  return parsed;
}

export function maintenanceMinutes(stateDir: string, sinceMs?: number): number {
  return listMaintenance(stateDir)
    .filter((entry) => sinceMs == null || Date.parse(entry.at) >= sinceMs)
    .reduce((sum, entry) => sum + entry.minutes, 0);
}
