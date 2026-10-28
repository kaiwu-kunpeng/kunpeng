import { alertLine, detectAlerts, loadLedger, type LoopRound } from "../metrics/loop-yield.js";
import { type CliContext, registerCliCommand } from "./registry.js";

function keyOf(r: Pick<LoopRound, "loop" | "project">): string {
  return `${r.loop}/${r.project}`;
}

registerCliCommand({
  name: "loop-yield",
  run: async (context: CliContext) => {
    const ledger = await loadLedger(context.repoRoot);

    // 每个 key 的最近一轮 input/yield 与总轮数。
    const latest = new Map<string, { loop: string; project: string; last: LoopRound; total: number }>();
    for (const r of ledger.rounds) {
      const k = keyOf(r);
      const cur = latest.get(k);
      if (cur) {
        cur.last = r;
        cur.total += 1;
      } else {
        latest.set(k, { loop: r.loop, project: r.project, last: r, total: 1 });
      }
    }

    if (latest.size === 0) {
      console.log("[loop-yield] 台账为空：暂无任何循环记账。");
      return;
    }

    const rows = [...latest.values()].sort(
      (a, b) => a.loop.localeCompare(b.loop) || a.project.localeCompare(b.project),
    );
    for (const row of rows) {
      console.log(
        `${row.loop}/${row.project} ｜ 最近一轮 input=${row.last.input} yield=${row.last.yield} ｜ 总轮数 ${row.total}`,
      );
    }

    const alerts = detectAlerts(ledger);
    if (alerts.length > 0) {
      for (const a of alerts) console.log(alertLine(a));
      process.exitCode = 1;
    }
  },
});
