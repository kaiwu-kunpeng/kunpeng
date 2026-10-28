export const APPROVED_EXPIRY_DAYS = 30;
export const APPROVED_EXPIRED_REASON = "approved 超 30 天未落地，自动退回";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ExpiryStore {
  list(kind: "proposal"): Promise<Array<{ id: string; status: string }>>;
  patchMeta(id: string, meta: Record<string, unknown>): Promise<unknown>;
  transition(id: string, to: "rolled-back"): Promise<unknown>;
}

export interface ExpiryDeps {
  nowMs: number;
  mtimeOf: (id: string) => Promise<number>;
  maxAgeMs?: number;
  log?: (line: string) => void;
}

export function isApprovedExpired(
  p: { status: string },
  opts: { nowMs: number; anchorMs: number; maxAgeMs?: number },
): boolean {
  return p.status === "approved"
    && opts.nowMs - opts.anchorMs > (opts.maxAgeMs ?? APPROVED_EXPIRY_DAYS * DAY_MS);
}

export async function expireStaleApproved(
  store: ExpiryStore,
  deps: ExpiryDeps,
): Promise<{ expired: string[] }> {
  const expired: string[] = [];
  const log = deps.log ?? console.log;
  const approved = (await store.list("proposal")).filter((p) => p.status === "approved");
  for (const p of approved) {
    try {
      const anchorMs = await deps.mtimeOf(p.id);
      if (!isApprovedExpired(p, { nowMs: deps.nowMs, anchorMs, maxAgeMs: deps.maxAgeMs })) continue;
      await store.patchMeta(p.id, {
        humanDecision: "expired",
        expiredAt: new Date(deps.nowMs).toISOString(),
        expiredReason: APPROVED_EXPIRED_REASON,
      });
      await store.transition(p.id, "rolled-back");
      expired.push(p.id);
      const days = Math.floor((deps.nowMs - anchorMs) / DAY_MS);
      log(`[应用] 提案 ${p.id} approved 已 ${days} 天未落地，自动退回 rolled-back（${APPROVED_EXPIRED_REASON}）`);
    } catch (error) {
      log(`[应用] 提案 ${p.id} 过期退回失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { expired };
}
