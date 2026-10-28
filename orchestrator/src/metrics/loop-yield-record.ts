import {
  type LoopAlert,
  type LoopRound,
  alertLine,
  detectAlerts,
  loadLedger,
  recordRound,
  saveLedger,
} from "./loop-yield.js";

/**
 * 薄 IO 壳：读台账 → 追加本轮（at=Date.now()）→ 存 → 检出本 key 告警并打印。
 * 整函数绝不抛；任何 IO 失败返回 null，不改变调用方任何行为或退出码。
 */
export async function recordAndWarn(
  repoRoot: string,
  round: Omit<LoopRound, "at">,
): Promise<LoopAlert[] | null> {
  try {
    const full: LoopRound = { ...round, at: Date.now() };
    const ledger = recordRound(await loadLedger(repoRoot), full);
    await saveLedger(repoRoot, ledger);
    const alerts = detectAlerts(ledger).filter(
      (a) => a.loop === round.loop && a.project === round.project,
    );
    for (const a of alerts) console.log(alertLine(a));
    return alerts;
  } catch {
    return null;
  }
}
