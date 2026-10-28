import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const WORKER_TOKEN_VERSION = "w1";
export const WORKER_PROTOCOL_VERSION = 1;

export interface ParsedWorkerToken {
  accountId: string;
  machineId: string;
  issuedAt: number;
}

export function signWorkerToken(
  accountId: string,
  machineId: string,
  secret: string,
  now: number,
): string {
  const payload = `${WORKER_TOKEN_VERSION}.${accountId}.${machineId}.${now}`;
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function verifyWorkerToken(
  token: string,
  secret: string,
  now: number,
  maxAgeMs: number,
): ParsedWorkerToken | null {
  const parts = token.split(".");
  if (parts.length !== 5) return null;

  const [version, accountId, machineId, issuedAtRaw, signature] = parts;
  if (version !== WORKER_TOKEN_VERSION || !accountId || !machineId || !issuedAtRaw || !signature) return null;

  const payload = `${WORKER_TOKEN_VERSION}.${accountId}.${machineId}.${issuedAtRaw}`;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const actualBytes = Buffer.from(signature, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null;

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt) || now - issuedAt > maxAgeMs || now - issuedAt < 0) return null;

  return { accountId, machineId, issuedAt };
}

export function newMachineId(): string {
  return randomBytes(16).toString("hex");
}

export function checkWorkerProtocol(clientVersion: number): { ok: true } | { ok: false; reason: string } {
  if (clientVersion === WORKER_PROTOCOL_VERSION) return { ok: true };
  return {
    ok: false,
    reason: `Worker protocol mismatch: client ${clientVersion}, host ${WORKER_PROTOCOL_VERSION}`,
  };
}
