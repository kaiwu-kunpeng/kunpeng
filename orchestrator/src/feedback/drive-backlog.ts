import type { ReinjectStore, ReinjectEntry } from "./reinject-store.js";

export interface DriveOutcome {
  fingerprint: string;
  requirement: string;
  status: string;
  consumed: boolean;
  deferred?: boolean;
}

export interface DriveReport {
  picked: number;
  consumed: number;
  failed: number;
  deferred: number;
  outcomes: DriveOutcome[];
}

/**
 * 飞轮驱动器：从 backlog 取 pending,逐条喂 runOne(cli 注入真实 DevCycle.run),
 * 返回 status==="verified" 则 markConsumed(消费),否则保留待下次。纯编排——runOne/now 注入便于测试。
 * - max:本轮最多处理几条(默认全部 pending);
 * - stopOnFail:遇非 verified 即停(默认 false=继续处理后续);
 * runOne 抛错按一次 failed 计、不消费、记 status="error:<msg>",不让整轮崩(单条失败不连累其余)。
 */
export async function runBacklogDriver(deps: {
  store: ReinjectStore;
  runOne: (requirement: string, entry: ReinjectEntry) => Promise<{ status: string }>;
  now: () => number;
  max?: number;
  maxAttempts?: number;
  stopOnFail?: boolean;
}): Promise<DriveReport> {
  const pending = await deps.store.pending();
  const picked = deps.max !== undefined ? pending.slice(0, deps.max) : pending;
  const outcomes: DriveOutcome[] = [];
  let consumed = 0;
  let failed = 0;
  let deferred = 0;

  for (const entry of picked) {
    let status: string;
    try {
      ({ status } = await deps.runOne(entry.requirement, entry));
    } catch (err) {
      status = `error:${err instanceof Error ? err.message : String(err)}`;
    }
    const ok = status === "verified";
    if (ok) {
      await deps.store.markConsumed(entry.fingerprint, deps.now());
      consumed++;
    } else {
      const result = await deps.store.recordFailure(entry.fingerprint, deps.now(), deps.maxAttempts ?? 2);
      failed++;
      if (result.deferred) deferred++;
    }
    outcomes.push({
      fingerprint: entry.fingerprint,
      requirement: entry.requirement,
      status,
      consumed: ok,
      deferred: ok ? false : undefined,
    });
    if (!ok && deps.stopOnFail) break;
  }

  return { picked: picked.length, consumed, failed, deferred, outcomes };
}
