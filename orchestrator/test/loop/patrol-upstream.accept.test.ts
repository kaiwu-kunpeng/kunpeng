import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { patrolUpstream } from "../../src/loop/patrol.js";
import { detectAlerts, recordRound, type LoopYieldLedger } from "../../src/metrics/loop-yield.js";

function run(rounds: Array<{ freshChanges: number; skippedExperiences: number; proposal: boolean }>): LoopYieldLedger {
  let ledger: LoopYieldLedger = { rounds: [] };
  rounds.forEach((r, i) => {
    ledger = recordRound(ledger, {
      loop: "patrol", project: "p", input: r.freshChanges, yield: r.proposal ? r.freshChanges : 0, at: i + 1,
      upstream: patrolUpstream(r),
    });
  });
  return ledger;
}

describe("patrol 上游量（作者锁定）", () => {
  test("patrolUpstream = 净新 + 无验真跳过", () => {
    expect(patrolUpstream({ freshChanges: 0, skippedExperiences: 0 })).toBe(0);
    expect(patrolUpstream({ freshChanges: 3, skippedExperiences: 0 })).toBe(3);
    expect(patrolUpstream({ freshChanges: 0, skippedExperiences: 6 })).toBe(6);
    expect(patrolUpstream({ freshChanges: 2, skippedExperiences: 5 })).toBe(7);
  });

  test("上游一直没货的 15 轮 → 闲置，不报饿死", () => {
    const ledger = run(Array.from({ length: 15 }, () => ({ freshChanges: 0, skippedExperiences: 0, proposal: false })));
    expect(detectAlerts(ledger)).toEqual([]);
  });

  test("上游有被跳过的候选、却连续 15 轮零输入 → 仍报饿死", () => {
    const ledger = run(Array.from({ length: 15 }, () => ({ freshChanges: 0, skippedExperiences: 4, proposal: false })));
    const alerts = detectAlerts(ledger);
    expect(alerts.map((a) => a.kind)).toEqual(["starved"]);
  });

  test("loop-core 的 patrol 记账真的传了 upstream", async () => {
    const core = await readFile(new URL("../../src/cli-commands/loop-core.ts", import.meta.url), "utf8");
    const at = core.indexOf('loop: "patrol"');
    expect(at).toBeGreaterThan(0);
    const block = core.slice(at, at + 400);
    expect(block).toMatch(/upstream:\s*patrolUpstream\(r\)/);
  });
});