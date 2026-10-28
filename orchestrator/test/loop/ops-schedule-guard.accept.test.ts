import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendOpsSchedule, opsSchedulePath, readOpsSchedule, type OpsScheduleEntry } from "../../src/loop/ops-playbook-run.js";
import { ALERT_DEDUPE_MS, AUTO_PAUSE_ERRORS, alertedRecently, consecutiveErrorCount, isMissed, planOpsTick, shouldAutoPause } from "../../src/loop/ops-schedule-guard.js";
import type { PlaybookDef } from "../../src/loop/playbook.js";

// 背景（ADR-0020 / 审计 P1-1b、P1-4 后半）：外部脚本退役后，「该跑没跑」「一直在失败」要有人知道。
// 本测试锁定：应跑账本可读（坏行跳过）；连续 3 次 error 自动暂停、`ops resume` 解除；到期超两个周期无成功波判漏跑；
// 两类告警 24h 去重；定时器一轮的决策是纯函数、每个 playbook 一条。

const DAY = 86_400_000;
const dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "kp-ops-guard-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function pb(id: string, over: Partial<PlaybookDef> = {}): PlaybookDef {
  return { id, title: id, loopId: `loop-${id}`, cadence: "every:3d", gate: "auto", sections: {}, body: "", ...over };
}
function e(playbookId: string, outcome: OpsScheduleEntry["outcome"], at: number): OpsScheduleEntry {
  return { at, playbookId, loopId: `loop-${playbookId}`, outcome };
}

describe("应跑账本守卫（作者锁定）", () => {
  it("账本可读、坏行跳过；追加后能读回", async () => {
    const stateDir = tmp();
    mkdirSync(join(stateDir, "ops"), { recursive: true });
    writeFileSync(opsSchedulePath(stateDir), `${JSON.stringify(e("a", "ran", 1))}\n{坏行\n${JSON.stringify({ at: 2, playbookId: "b" })}\n`, "utf8");
    await appendOpsSchedule(stateDir, e("a", "error", 3));
    const entries = await readOpsSchedule(stateDir);
    expect(entries.map((x) => [x.playbookId, x.outcome, x.at])).toEqual([["a", "ran", 1], ["a", "error", 3]]);
  });

  it("连续失败计数：跳过 paused/missed/locked 告警行；ran/gated/skipped/resumed 归零；阈值 3", () => {
    const entries = [e("a", "ran", 1), e("a", "error", 2), e("a", "paused", 3), e("a", "error", 4), e("b", "error", 5), e("a", "error", 6)];
    expect(consecutiveErrorCount(entries, "a")).toBe(3);
    expect(consecutiveErrorCount(entries, "b")).toBe(1);
    expect(shouldAutoPause(entries, "a")).toBe(true);
    expect(shouldAutoPause(entries, "b")).toBe(false);
    expect(consecutiveErrorCount([...entries, e("a", "resumed", 7)], "a")).toBe(0);
    expect(consecutiveErrorCount([...entries, e("a", "gated", 7), e("a", "error", 8)], "a")).toBe(1);
    expect(AUTO_PAUSE_ERRORS).toBe(3);
  });

  it("漏跑判定：距上一波 ≥ 2 个周期且期间无 ran → 漏跑；最近有 ran / 从未跑过 / 没 loopId → 不算", () => {
    const now = 100 * DAY;
    const p = pb("a", { cadence: "every:3d" });
    expect(isMissed(p, now - 7 * DAY, [], now)).toBe(true);
    expect(isMissed(p, now - 7 * DAY, [e("a", "ran", now - 5 * DAY)], now)).toBe(false);
    expect(isMissed(p, now - 7 * DAY, [e("a", "ran", now - 8 * DAY)], now)).toBe(true);
    expect(isMissed(p, now - 4 * DAY, [], now)).toBe(false);
    expect(isMissed(p, undefined, [], now)).toBe(false);
    expect(isMissed(pb("x", { loopId: undefined }), now - 30 * DAY, [], now)).toBe(false);
  });

  it("告警 24h 去重", () => {
    const now = 100 * DAY;
    expect(alertedRecently([e("a", "missed", now - DAY + 1)], "a", "missed", now)).toBe(true);
    expect(alertedRecently([e("a", "missed", now - DAY - 1)], "a", "missed", now)).toBe(false);
    expect(alertedRecently([e("a", "paused", now - 1)], "a", "missed", now)).toBe(false);
    expect(ALERT_DEDUPE_MS).toBe(DAY);
  });

  it("一轮决策：launch / gate / locked / paused(+quiet) / missed(+quiet) / not-due / no-loop 各归其位", () => {
    const now = 100 * DAY;
    const playbooks = [
      pb("go"), pb("rev", { gate: "review" }), pb("busy"), pb("bad"), pb("bad2"), pb("late", { cadence: "weekly" }), pb("idle"), pb("orphan", { loopId: undefined }),
    ];
    const entries = [
      ...[1, 2, 3].map((i) => e("bad", "error", now - i * 1000)),
      ...[1, 2, 3].map((i) => e("bad2", "error", now - i * 1000)), e("bad2", "paused", now - 3_600_000),
      e("late", "missed", now - 2 * DAY),
    ];
    const decisions = planOpsTick({
      playbooks,
      due: new Set(["go", "rev", "busy", "bad", "bad2", "late"]),
      lastRunByLoop: { "loop-go": now - 4 * DAY, "loop-late": now - 30 * DAY, "loop-idle": now - DAY },
      entries,
      lockBusy: (loopId) => loopId === "loop-busy",
      now,
    });
    const byId = (id: string) => decisions.filter((d) => d.playbookId === id).map((d) => d.action);
    expect(byId("go")).toEqual(["launch"]);
    expect(byId("rev")).toEqual(["gate"]);
    expect(byId("busy")).toEqual(["locked"]);
    expect(byId("bad")).toEqual(["paused"]);
    expect(byId("bad2")).toEqual(["paused-quiet"]);
    expect(byId("late")).toEqual(["missed", "launch"]);
    expect(byId("idle")).toEqual(["not-due"]);
    expect(byId("orphan")).toEqual(["no-loop"]);
    expect(decisions.find((d) => d.playbookId === "bad")?.detail).toContain("kunpeng ops resume bad");
  });

  it("定时器接线：ops 用 planOpsTick 决策，告警是 urgent 总机消息且 origin=schedule，有 resume 子命令", () => {
    const src = readFileSync(new URL("../../src/cli-commands/ops.ts", import.meta.url), "utf8");
    expect(src).toContain("planOpsTick({");
    expect(src).toContain('context.rest[0] === "resume"');
    expect(src).toContain('outcome: "resumed"');
    expect(src).toContain('urgent: true, origin: { kind: "schedule" }');
    expect(src).toContain("duePlaybooks(playbooks, lastRunByLoop, now)");
    expect(src).not.toContain("loopRunArgs(loopId, context.repoRoot)");
  });
});