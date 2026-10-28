import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExecutionKind } from "./execution-backend.js";

export function isValidBackendKind(s: unknown): s is ExecutionKind {
  return s === "local" || s === "codex-cloud";
}

function normalizeBackendKind(s: string | undefined): ExecutionKind | undefined {
  const normalized = s?.trim().toLowerCase();
  return isValidBackendKind(normalized) ? normalized : undefined;
}

export function backendPrefPath(kunpengHome: string): string {
  return join(kunpengHome, ".kunpeng", "execution-backend.json");
}

export async function readBackendPreference(kunpengHome: string): Promise<ExecutionKind | undefined> {
  try {
    const raw = JSON.parse(await readFile(backendPrefPath(kunpengHome), "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const backend = (raw as Record<string, unknown>).backend;
    return isValidBackendKind(backend) ? backend : undefined;
  } catch {
    return undefined;
  }
}

export async function writeBackendPreference(kunpengHome: string, kind: ExecutionKind): Promise<void> {
  const path = backendPrefPath(kunpengHome);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ backend: kind }, null, 2)}\n`, "utf8");
}

export function resolveEffectiveKind(
  env: Record<string, string | undefined>,
  pref: ExecutionKind | undefined,
): ExecutionKind {
  return normalizeBackendKind(env.KUNPENG_EXECUTION_BACKEND) ?? pref ?? "local";
}
