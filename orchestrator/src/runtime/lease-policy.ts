export const LEASE_EXPIRY_FACTOR = 2;

export function leaseTtlForStage(stage: string): number {
  switch (stage) {
    case "audit": return 120_000;
    case "implement":
    case "repair": return 900_000;
    case "verify": return 600_000;
    case "spec":
    default: return 300_000;
  }
}

export function leaseAgeMs(lease: { renewedAt: number }, now: number): number {
  return Math.max(0, now - lease.renewedAt);
}

export function leaseExpired(lease: { renewedAt: number; ttlMs: number }, now: number): boolean {
  return leaseAgeMs(lease, now) > LEASE_EXPIRY_FACTOR * lease.ttlMs;
}
