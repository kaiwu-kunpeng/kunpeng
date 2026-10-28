import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Backend } from "./backend-routing.js";
import { isRecord } from "../util/is-record.js";

export interface BackendHealthEntry { downUntil: number; reason: string; kind: string; at: number }
export interface BackendHealthFile {
  backends: Record<string, BackendHealthEntry>;
  models: Record<string, BackendHealthEntry>;
}

export const EMPTY_RESPONSE_TTL_MS = 5 * 60_000;
export const DEGRADE_LADDER: Readonly<Record<Backend, readonly string[]>> = {
  claude: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
  codex: ["gpt-6-astra", "gpt-5.6-terra", "gpt-5.6-luna"],
};

export function backendHealthPath(kunpengDir: string): string {
  return join(kunpengDir, "backend-health.json");
}

export function resolveBackendDownTtlMs(env: NodeJS.ProcessEnv): number {
  const raw = env.KUNPENG_BACKEND_DOWN_TTL_MS ?? "";
  const ttl = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(ttl) && ttl > 0 ? ttl : 30 * 60_000;
}

function isEntry(value: unknown): value is BackendHealthEntry {
  return isRecord(value) && typeof value.downUntil === "number" && Number.isFinite(value.downUntil)
    && typeof value.at === "number" && Number.isFinite(value.at)
    && typeof value.reason === "string" && typeof value.kind === "string";
}

export function loadBackendHealth(path: string, now: number): BackendHealthFile {
  const empty: BackendHealthFile = { backends: {}, models: {} };
  try {
    const file: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(file) || !isRecord(file.backends) || !isRecord(file.models)) return empty;
    const backends = Object.entries(file.backends);
    const models = Object.entries(file.models);
    if (![...backends, ...models].every(([, entry]) => isEntry(entry))) return empty;
    const active = (entries: [string, unknown][]): Record<string, BackendHealthEntry> => Object.fromEntries(
      entries.filter((entry): entry is [string, BackendHealthEntry] => isEntry(entry[1]) && entry[1].downUntil > now),
    );
    return { backends: active(backends), models: active(models) };
  } catch {
    return empty;
  }
}

interface DownMark { kind: string; reason: string; ttlMs: number; now: number }
let sequence = 0;

function markDown(path: string, group: keyof BackendHealthFile, key: string, mark: DownMark): BackendHealthFile {
  const file = loadBackendHealth(path, mark.now);
  if (mark.ttlMs <= 0) return file;
  file[group] = { ...file[group], [key]: {
    downUntil: mark.now + mark.ttlMs, reason: mark.reason.slice(0, 300), kind: mark.kind, at: mark.now,
  } };
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${sequence++}.tmp`;
  writeFileSync(temporary, JSON.stringify(file), "utf8");
  renameSync(temporary, path);
  return file;
}

export function markBackendDown(path: string, backend: string, mark: DownMark): BackendHealthFile {
  return markDown(path, "backends", backend, mark);
}

export function markModelDown(path: string, backend: string, model: string, mark: DownMark): BackendHealthFile {
  return markDown(path, "models", `${backend}:${model}`, mark);
}

export function downBackends(file: BackendHealthFile, now: number): Set<string> {
  return new Set(Object.entries(file.backends).filter(([, entry]) => entry.downUntil > now).map(([backend]) => backend));
}

export function downModels(file: BackendHealthFile, backend: string, now: number): Set<string> {
  const prefix = `${backend}:`;
  return new Set(Object.entries(file.models)
    .filter(([key, entry]) => key.startsWith(prefix) && entry.downUntil > now)
    .map(([key]) => key.slice(prefix.length)));
}

export function nextModel(backend: Backend, current: string | undefined, down: ReadonlySet<string>): string | undefined {
  const ladder = DEGRADE_LADDER[backend];
  const index = current === undefined ? -1 : ladder.indexOf(current);
  return ladder.slice(index + 1).find((model) => !down.has(model));
}

export function effectiveChain(opts: { enabled: readonly string[]; file: BackendHealthFile; now: number }): {
  order: string[];
  down: { backend: string; reason: string; kind: string; until: number }[];
  modelsDown: { backend: string; model: string; reason: string; kind: string; until: number }[];
} {
  const { enabled, file, now } = opts;
  const unavailable = downBackends(file, now);
  const byBackend = (a: { backend: string }, b: { backend: string }): number => a.backend.localeCompare(b.backend);
  return {
    order: ["claude", "codex"].filter((backend) => enabled.includes(backend) && !unavailable.has(backend)),
    down: Object.entries(file.backends).filter(([, entry]) => entry.downUntil > now)
      .map(([backend, entry]) => ({ backend, reason: entry.reason, kind: entry.kind, until: entry.downUntil })).sort(byBackend),
    modelsDown: Object.entries(file.models).filter(([, entry]) => entry.downUntil > now)
      .map(([key, entry]) => {
        const separator = key.indexOf(":");
        return { backend: key.slice(0, separator), model: key.slice(separator + 1), reason: entry.reason, kind: entry.kind, until: entry.downUntil };
      }).sort(byBackend),
  };
}
