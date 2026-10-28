import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface ServeHeartbeat {
  ts: number;
  port?: number;
  pid?: number;
}

export function serveHeartbeatFile(stateDir: string): string {
  return join(stateDir, "serve-heartbeat.json");
}

export function isServeOnline(
  hb: { ts: number } | null,
  now: number,
  windowMs = 90_000,
): boolean {
  if (!hb || typeof hb.ts !== "number" || !Number.isFinite(hb.ts)) return false;
  const age = now - hb.ts;
  return Number.isFinite(age) && age >= 0 && age <= windowMs;
}

export async function writeServeHeartbeat(stateDir: string, hb: ServeHeartbeat): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  const file = serveHeartbeatFile(stateDir);
  const temporaryFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryFile, `${JSON.stringify(hb)}\n`, "utf8");
    await rename(temporaryFile, file);
  } catch (error) {
    await rm(temporaryFile, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readServeHeartbeat(stateDir: string): Promise<ServeHeartbeat | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(serveHeartbeatFile(stateDir), "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as { ts?: unknown; port?: unknown; pid?: unknown };
    if (typeof candidate.ts !== "number" || !Number.isFinite(candidate.ts)) return null;
    if (candidate.port !== undefined && (typeof candidate.port !== "number" || !Number.isFinite(candidate.port))) return null;
    if (candidate.pid !== undefined && (typeof candidate.pid !== "number" || !Number.isFinite(candidate.pid))) return null;
    return {
      ts: candidate.ts,
      ...(typeof candidate.port === "number" ? { port: candidate.port } : {}),
      ...(typeof candidate.pid === "number" ? { pid: candidate.pid } : {}),
    };
  } catch {
    return null;
  }
}
