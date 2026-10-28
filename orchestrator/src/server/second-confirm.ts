import { randomBytes } from "node:crypto";

export const CONFIRM_TOKEN_TTL_MS = 120_000;

const pending = new Map<string, { key: string; issuedAt: number }>();

function prune(now: number): void {
  for (const [token, entry] of pending) {
    if (now - entry.issuedAt > CONFIRM_TOKEN_TTL_MS) pending.delete(token);
  }
}

export function issueConfirmToken(key: string, now: number = Date.now()): string {
  prune(now);
  const token = randomBytes(16).toString("hex");
  pending.set(token, { key, issuedAt: now });
  return token;
}

export function pendingConfirmTokenCount(): number {
  return pending.size;
}

export function consumeConfirmToken(key: string, token: string, now: number = Date.now()): boolean {
  const entry = pending.get(token);
  if (!entry) return false;
  if (now - entry.issuedAt > CONFIRM_TOKEN_TTL_MS) { pending.delete(token); return false; }
  if (entry.key !== key) return false;
  pending.delete(token);
  return true;
}
