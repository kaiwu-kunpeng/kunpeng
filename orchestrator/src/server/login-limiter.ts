import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { isLoopbackAddress } from "./auth.js";

export interface LimiterCheck {
  allowed: boolean;
  retryAfterMs?: number;
}

export interface LoginLimiter {
  check(key: string, now: number): LimiterCheck;
  recordFail(key: string, now: number): void;
  recordSuccess(key: string): void;
}

export function resolveLoginClientIp(input: { remoteAddress?: string; cfConnectingIp?: string }): string {
  return isLoopbackAddress(input.remoteAddress) && input.cfConnectingIp
    ? input.cfConnectingIp
    : input.remoteAddress ?? "";
}

export function createLoginLimiter(opts?: {
  maxFails?: number;
  windowMs?: number;
  lockMs?: number;
  persistPath?: string;
}): LoginLimiter {
  const maxFails = opts?.maxFails ?? 5;
  const windowMs = opts?.windowMs ?? 10 * 60 * 1000;
  const lockMs = opts?.lockMs ?? 60 * 1000;
  const persistPath = opts?.persistPath;
  const failures = new Map<string, number[]>();

  if (persistPath !== undefined) {
    try {
      const data: unknown = JSON.parse(readFileSync(persistPath, "utf8"));
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw new Error("Invalid login limiter data");
      }
      for (const [key, timestamps] of Object.entries(data)) {
        if (!Array.isArray(timestamps) || !timestamps.every((at: unknown) => typeof at === "number" && Number.isFinite(at))) {
          throw new Error("Invalid login limiter timestamps");
        }
        failures.set(key, timestamps);
      }
    } catch (error) {
      failures.clear();
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("[login-limiter] Failed to load counts; starting empty:", error);
      }
    }
  }

  const persist = (): void => {
    if (persistPath === undefined) return;
    try {
      writeFileSync(persistPath, JSON.stringify(Object.fromEntries(failures)), { mode: 0o600 });
      chmodSync(persistPath, 0o600);
    } catch (error) {
      console.warn("[login-limiter] Failed to persist counts:", error);
    }
  };

  const windowed = (key: string, now: number): number[] => {
    const kept = (failures.get(key) ?? []).filter((at) => now - at <= windowMs);
    if (kept.length > 0) failures.set(key, kept);
    else failures.delete(key);
    return kept;
  };

  return {
    check(key: string, now: number): LimiterCheck {
      const kept = windowed(key, now);
      if (kept.length < maxFails) return { allowed: true };
      const lastFail = kept[kept.length - 1] ?? now;
      const retryAfterMs = lastFail + lockMs - now;
      return retryAfterMs > 0 ? { allowed: false, retryAfterMs } : { allowed: true };
    },

    recordFail(key: string, now: number): void {
      failures.set(key, [...windowed(key, now), now]);
      persist();
    },

    recordSuccess(key: string): void {
      if (failures.delete(key)) persist();
    },
  };
}
