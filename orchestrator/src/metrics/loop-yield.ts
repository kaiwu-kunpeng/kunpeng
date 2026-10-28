import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** 一轮循环的产出记账：input=本轮可处理量，yield=真处理量。 */
export interface LoopRound {
  loop: string;
  project: string;
  input: number;
  yield: number;
  at: number;
  /** 上游待处理量（可选）。显式 0 = 上游本就没活（闲置），这样的轮次不计入饿死；缺省沿用旧口径。 */
  upstream?: number;
}

/** 全部循环全部项目的记账台账（追加式，按 key 封顶）。 */
export interface LoopYieldLedger {
  rounds: LoopRound[];
}

export type LoopAlertKind = "stalled" | "starved";

export interface LoopAlert {
  loop: string;
  project: string;
  kind: LoopAlertKind;
  streak: number;
  since: number;
}

/** 连续 K 轮 input>0 && yield===0 → 空转(stalled)：机件坏了。 */
export const STALLED_THRESHOLD = 3;
/** 连续 M 轮 input===0 且上游并非明确没活（upstream 缺省或 >0）→ 饿死(starved)：输入管道死了。
 *  upstream===0 的轮次是「闲置」不是「饿死」：闲置项目每轮报饿死会淹没真告警。 */
export const STARVED_THRESHOLD = 10;
/** 每个 (loop,project) key 最多保留的轮次条数。 */
export const MAX_ROUNDS_PER_KEY = 200;

function keyOf(r: Pick<LoopRound, "loop" | "project">): string {
  return `${r.loop} ${r.project}`;
}

/**
 * 追加一轮记账并返回新台账（纯函数，不改入参）。
 * 末尾追加；仅对与本轮同 key 的记录封顶到最近 `max` 条，不影响别的 key。
 */
export function recordRound(
  ledger: LoopYieldLedger,
  round: LoopRound,
  max = MAX_ROUNDS_PER_KEY,
): LoopYieldLedger {
  const rounds = [...ledger.rounds, round];
  const k = keyOf(round);
  const sameKeyCount = rounds.reduce((n, r) => (keyOf(r) === k ? n + 1 : n), 0);
  if (sameKeyCount <= max) return { rounds };
  let toDrop = sameKeyCount - max;
  const kept: LoopRound[] = [];
  for (const r of rounds) {
    if (toDrop > 0 && keyOf(r) === k) {
      toDrop -= 1;
      continue;
    }
    kept.push(r);
  }
  return { rounds: kept };
}

function isLoopRound(v: unknown): v is LoopRound {
  if (typeof v !== "object" || v == null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.loop === "string" &&
    typeof r.project === "string" &&
    typeof r.input === "number" &&
    typeof r.yield === "number" &&
    typeof r.at === "number" &&
    (r.upstream === undefined || typeof r.upstream === "number")
  );
}

/**
 * 从最近一轮回数，逐 key 检出至多一条告警：
 * stalled(input>0&&yield===0) 优先于 starved(input===0)；
 * since=连续段最早那轮 at；按 loop→project 字典序返回。
 */
export function detectAlerts(
  ledger: LoopYieldLedger,
  thresholds: { stalled?: number; starved?: number } = {},
): LoopAlert[] {
  const stalled = thresholds.stalled ?? STALLED_THRESHOLD;
  const starved = thresholds.starved ?? STARVED_THRESHOLD;

  const byKey = new Map<string, LoopRound[]>();
  for (const r of ledger.rounds) {
    const list = byKey.get(keyOf(r));
    if (list) list.push(r);
    else byKey.set(keyOf(r), [r]);
  }

  const alerts: LoopAlert[] = [];
  for (const rounds of byKey.values()) {
    const last = rounds[rounds.length - 1];
    if (!last) continue;

    // 空转段：从末尾回数连续的 input>0 && yield===0。
    let stalledStreak = 0;
    for (let i = rounds.length - 1; i >= 0; i -= 1) {
      const r = rounds[i];
      if (r.input > 0 && r.yield === 0) stalledStreak += 1;
      else break;
    }
    if (stalledStreak >= stalled) {
      const first = rounds[rounds.length - stalledStreak];
      alerts.push({
        loop: last.loop,
        project: last.project,
        kind: "stalled",
        streak: stalledStreak,
        since: first.at,
      });
      continue;
    }

    // 饿死段：从末尾回数连续的 input===0 且上游不是明确没活（upstream===0 = 闲置，打断饿死段）。
    let starvedStreak = 0;
    for (let i = rounds.length - 1; i >= 0; i -= 1) {
      if (rounds[i].input === 0 && rounds[i].upstream !== 0) starvedStreak += 1;
      else break;
    }
    if (starvedStreak >= starved) {
      const first = rounds[rounds.length - starvedStreak];
      alerts.push({
        loop: last.loop,
        project: last.project,
        kind: "starved",
        streak: starvedStreak,
        since: first.at,
      });
    }
  }

  return alerts.sort((a, b) => a.loop.localeCompare(b.loop) || a.project.localeCompare(b.project));
}

/** 把一条告警渲染成一行人读文案。 */
export function alertLine(alert: LoopAlert): string {
  const kind = alert.kind === "stalled" ? "空转(机件坏了)" : "饿死(输入管道死了)";
  return `[告警] 循环 ${alert.loop}/${alert.project} ${kind} 已连续 ${alert.streak} 轮（since=${alert.since}）`;
}

/** 台账落盘路径：<repoRoot>/.kunpeng/loop-yield.json。 */
export function loopYieldPath(repoRoot: string): string {
  return join(repoRoot, ".kunpeng", "loop-yield.json");
}

/** 读台账；损坏/缺失/形状不对一律返回 {rounds:[]}，绝不抛。 */
export async function loadLedger(repoRoot: string): Promise<LoopYieldLedger> {
  try {
    const raw = await readFile(loopYieldPath(repoRoot), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed == null) return { rounds: [] };
    const rounds = (parsed as { rounds?: unknown }).rounds;
    if (!Array.isArray(rounds) || !rounds.every(isLoopRound)) return { rounds: [] };
    return { rounds };
  } catch {
    return { rounds: [] };
  }
}

/** 存台账；目录自动建，与 loadLedger 往返一致。 */
export async function saveLedger(repoRoot: string, ledger: LoopYieldLedger): Promise<void> {
  const file = loopYieldPath(repoRoot);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}
