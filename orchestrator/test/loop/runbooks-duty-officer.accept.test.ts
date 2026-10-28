import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/cli-commands/duty.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import { RUNBOOK_EVENT_KINDS } from "../../src/loop/runbooks/catalog.js";
import { defaultDutyExecutors, readRunbookRuns, runDutyTick, runbookLedgerPath, type DutyExecutors } from "../../src/loop/runbooks/duty-officer.js";
import { BACKEND_DOWN_PREFIX, eventsFromFlows, eventsFromOpsTick, eventsFromOutbox, withRetries } from "../../src/loop/runbooks/events.js";
import type { RunbookEvent } from "../../src/loop/runbooks/types.js";
import type { NewMessageInput } from "../../src/switchboard/store.js";
import type { OutboxEntry } from "../../src/loop/outbox.js";
import { enqueueOutbox, listOutbox } from "../../src/loop/outbox.js";
import { FlowTracker, type FlowState } from "../../src/runtime/flowstate.js";

// 背景（2026-10-03 运营审计 A4 #1，总报告 P1-12 第二步）：P1-12a 只有纯决策层。本流接上事件源与执行器：
// 运营定时器决策 / 流状态 / outbox → 事件；值班员按手册执行白名单动作、落 append-only 台账；
// 转人与执行失败都 fail-closed 到人；`kunpeng duty tick [--dry]` 可跑一轮。本测试锁定这些行为。

let stateDir: string;
const noop = async (): Promise<undefined> => undefined;
const executors = (over: Partial<DutyExecutors> = {}): DutyExecutors => ({ stop: noop, degrade: noop, retry: noop, notify: noop, draft: noop, ...over });
const flow = (over: Partial<FlowState>): FlowState => ({ flowId: "f1", requirement: "r", stage: "done", status: "verified", agentActive: false, history: [], createdAt: 1, updatedAt: 1_000, ...over } as FlowState);

beforeEach(() => { stateDir = mkdtempSync(join(tmpdir(), "kp-duty-")); });
afterEach(() => { vi.restoreAllMocks(); rmSync(stateDir, { recursive: true, force: true }); });

describe("事件派生（作者锁定）", () => {
  it("定时器决策：paused/-quiet → ops.playbook.paused，missed/-quiet → ops.playbook.missed，其余忽略；范围带 playbookId/loopId", () => {
    const events = eventsFromOpsTick([
      { playbookId: "pb-a", loopId: "l-a", action: "paused", detail: "连续失败 3 次" },
      { playbookId: "pb-b", loopId: "l-b", action: "missed-quiet", detail: "超两个周期" },
      { playbookId: "pb-c", loopId: "l-c", action: "launch" },
      { playbookId: "pb-d", action: "no-loop" },
    ], "demo", 5_000);
    expect(events.map((e) => [e.kind, e.scope])).toEqual([
      [RUNBOOK_EVENT_KINDS.opsPaused, { projectId: "demo", playbookId: "pb-a", loopId: "l-a" }],
      [RUNBOOK_EVENT_KINDS.opsMissed, { projectId: "demo", playbookId: "pb-b", loopId: "l-b" }],
    ]);
  });

  it("流状态：running 且 pid 不在 → flow.ghost；verified 且 gateHold=guard-red → merge.guard-red；近期 [backend-down] 回滚 → dispatch.backend-down；陈年的不报", () => {
    const now = 100_000;
    const events = eventsFromFlows([
      flow({ flowId: "ghost", status: "running", pid: 4242 }),
      flow({ flowId: "alive", status: "running", pid: 1 }),
      flow({ flowId: "red", status: "verified", gateHold: { kind: "guard-red", reason: "× x.test.ts", at: 1 } }),
      flow({ flowId: "held", status: "verified", gateHold: { kind: "review-block", reason: "r", at: 1 } }),
      flow({ flowId: "down", status: "rolled-back", failureReason: `${BACKEND_DOWN_PREFIX} 无可用后端`, updatedAt: now - 1_000 }),
      flow({ flowId: "old", status: "rolled-back", failureReason: `${BACKEND_DOWN_PREFIX} 无可用后端`, updatedAt: now - 48 * 3_600_000 }),
      flow({ flowId: "other", status: "rolled-back", failureReason: "accept 红", updatedAt: now - 1_000 }),
    ], { projectId: "demo", isAlive: (pid) => pid === 1, now });
    expect(events.map((e) => `${e.kind}:${e.scope.flowId}`)).toEqual([`${RUNBOOK_EVENT_KINDS.flowGhost}:ghost`, `${RUNBOOK_EVENT_KINDS.mergeGuardRed}:red`, `${RUNBOOK_EVENT_KINDS.backendDown}:down`]);
  });

  it("outbox：ops 频道挂 ≥30 分钟的 git-push 待发条目 → outbox.push-failed，flowId 从 url 解出；新鲜/已发/别的频道不报", () => {
    const now = Date.parse("2026-10-04T12:00:00Z");
    const entry = (over: Partial<OutboxEntry>): OutboxEntry => ({ id: "obx-1", channel: "ops", at: "2026-10-04T11:00:00Z", status: "pending", payload: { urls: ["git-push://origin/main?flow=p1-x-0-0"], host: "origin", keyLocation: "main" }, ...over });
    const events = eventsFromOutbox([
      entry({}),
      entry({ id: "fresh", at: "2026-10-04T11:50:00Z" }),
      entry({ id: "done", status: "flushed" }),
      entry({ id: "seo", channel: "indexnow", payload: { urls: ["https://x/"] } }),
    ], { projectId: "demo", now });
    expect(events).toEqual([{ kind: RUNBOOK_EVENT_KINDS.outboxPushFailed, at: now, scope: { projectId: "demo", flowId: "p1-x-0-0" }, detail: { outboxId: "obx-1", base: "main" } }]);
    const e: RunbookEvent = { kind: "k", at: 1, scope: { flowId: "f" } };
    expect(withRetries(e, [{ at: 1, episodeKey: "k|flowId=f", eventKind: "k", outcome: "executed" }, { at: 2, episodeKey: "k|flowId=f", eventKind: "k", outcome: "escalated" }]).detail).toEqual({ retries: 1 });
  });
});

describe("值班员一轮（作者锁定）", () => {
  const ghost: RunbookEvent = { kind: RUNBOOK_EVENT_KINDS.flowGhost, at: 1, scope: { projectId: "demo", flowId: "f1" } };

  it("执行：按手册顺序调执行器、落台账 executed；同 episode 重复事件一轮只处置一次；下一轮进冷却", async () => {
    const calls: string[] = [];
    const ex = executors({ stop: async (a) => { calls.push(`stop:${a.summary}`); return "ok"; }, notify: async (a) => { calls.push(`notify:${a.summary}`); return undefined; } });
    const escalate = vi.fn(async () => undefined);
    const items = await runDutyTick({ stateDir, events: [ghost, ghost], executors: ex, escalate, now: 5_000 });
    expect(items.map((i) => i.outcome)).toEqual(["executed"]);
    expect(calls.map((c) => c.split(":")[0])).toEqual(["stop", "notify"]);
    expect(escalate).not.toHaveBeenCalled();
    const runs = await readRunbookRuns(stateDir);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ runbookId: "rb-flow-ghost", outcome: "executed", episodeKey: "flow.ghost|flowId=f1|projectId=demo" });
    expect(readFileSync(runbookLedgerPath(stateDir), "utf8").trim().split("\n")).toHaveLength(1);
    const again = await runDutyTick({ stateDir, events: [ghost], executors: ex, escalate, now: 6_000 });
    expect(again[0]).toMatchObject({ outcome: "cooldown" });
    expect(await readRunbookRuns(stateDir)).toHaveLength(1);
  });

  it("转人：无匹配手册 → escalate 并落 escalated；执行器抛错 → escalate、落 escalated、不再执行后续动作；--dry 不执行不落账", async () => {
    const escalate = vi.fn(async () => undefined);
    const unknown: RunbookEvent = { kind: "ops.unknown", at: 1, scope: { projectId: "demo" } };
    const items = await runDutyTick({ stateDir, events: [unknown], executors: executors(), escalate, now: 5_000 });
    expect(items[0]).toMatchObject({ outcome: "escalated", detail: "无匹配手册（ops.unknown）" });
    expect(escalate).toHaveBeenCalledWith(expect.objectContaining({ kind: "ops.unknown" }), "无匹配手册（ops.unknown）");
    const notify = vi.fn(async () => undefined);
    const boom = executors({ stop: async () => { throw new Error("tracker locked"); }, notify });
    const failed = await runDutyTick({ stateDir, events: [ghost], executors: boom, escalate, now: 5_000 });
    expect(failed[0]).toMatchObject({ outcome: "escalated", detail: "执行 stop 失败：tracker locked" });
    expect(notify).not.toHaveBeenCalled();
    expect((await readRunbookRuns(stateDir)).map((r) => r.outcome)).toEqual(["escalated", "escalated"]);
    const stop = vi.fn(async () => undefined);
    const other: RunbookEvent = { ...ghost, scope: { projectId: "demo", flowId: "f2" } };
    const dry = await runDutyTick({ stateDir, events: [other], executors: executors({ stop }), escalate, now: 5_000, dryRun: true });
    expect(dry[0]).toMatchObject({ outcome: "dry-run" });
    expect(dry[0]!.detail).toContain("[L2] stop:");
    expect(stop).not.toHaveBeenCalled();
    expect(await readRunbookRuns(stateDir)).toHaveLength(2);
  });

  it("重试类手册第二次：retries 来自台账 → 改走 notify 转人口径", async () => {
    const red: RunbookEvent = { kind: RUNBOOK_EVENT_KINDS.mergeGuardRed, at: 1, scope: { projectId: "demo", flowId: "f1" } };
    const kinds: string[] = [];
    const ex = executors({ retry: async (a) => { kinds.push(`retry:${a.level}`); return undefined; }, notify: async (a) => { kinds.push(`notify:${a.level}`); return undefined; } });
    await runDutyTick({ stateDir, events: [red], executors: ex, escalate: noop, now: 5_000 });
    await runDutyTick({ stateDir, events: [red], executors: ex, escalate: noop, now: 5_000 + 3 * 3_600_000 });
    expect(kinds).toEqual(["retry:L2", "notify:L1"]);
  });
});

describe("缺省执行器与 CLI（作者锁定）", () => {
  it("notify/draft 走总机（notify urgent、origin=schedule）；stop 标 crashed；degrade 写降级标记；retry 按事件派子进程 / 重放 outbox；无执行器的重试抛错", async () => {
    const repo = mkdtempSync(join(tmpdir(), "kp-duty-repo-"));
    const sent: NewMessageInput[] = [];
    const launched: string[][] = [];
    const tracker = new FlowTracker(join(repo, ".kunpeng", "state"));
    await tracker.start("f1", "幽灵");
    const push = vi.fn(async () => true);
    const ex = defaultDutyExecutors({ repoRoot: repo, stateDir, sender: { send: async (m) => { sent.push(m); } }, tracker, launch: (args) => { launched.push(args); return { pid: 77, logPath: "/dev/null" }; }, push, now: () => 9_000 });
    const scope = { projectId: "demo", flowId: "f1", playbookId: "pb-a" };
    await ex.notify({ kind: "notify", level: "L1", summary: "n", scope }, { kind: "x", at: 1, scope });
    await ex.draft({ kind: "draft", level: "L1", summary: "d", scope }, { kind: "x", at: 1, scope });
    expect(sent.map((m) => [m.from, m.urgent, m.origin?.kind, m.body])).toEqual([["duty", true, "schedule", "n"], ["duty", false, "schedule", "草稿：d"]]);
    expect(await ex.stop({ kind: "stop", level: "L2", summary: "宿主不在", scope }, { kind: RUNBOOK_EVENT_KINDS.flowGhost, at: 1, scope })).toContain("crashed");
    expect((await tracker.read("f1"))?.status).toBe("crashed");
    await ex.degrade({ kind: "degrade", level: "L1", summary: "暂停派流", scope }, { kind: RUNBOOK_EVENT_KINDS.backendDown, at: 1, scope });
    expect(readFileSync(join(stateDir, "ops", "degraded.jsonl"), "utf8")).toContain('"projectId":"demo"');
    await ex.retry({ kind: "retry", level: "L2", summary: "补跑", scope }, { kind: RUNBOOK_EVENT_KINDS.opsMissed, at: 1, scope });
    await ex.retry({ kind: "retry", level: "L2", summary: "复跑门", scope }, { kind: RUNBOOK_EVENT_KINDS.mergeGuardRed, at: 1, scope });
    expect(launched).toEqual([["ops", "run-playbook", "pb-a", "--repo", repo], ["merge", "f1", "--actor", "machine"]]);
    enqueueOutbox(repo, "ops", { urls: ["git-push://origin/main?flow=f1"], host: "origin", keyLocation: "main" });
    expect(await ex.retry({ kind: "retry", level: "L2", summary: "重放", scope }, { kind: RUNBOOK_EVENT_KINDS.outboxPushFailed, at: 1, scope })).toContain("已重放 1 条");
    expect(push).toHaveBeenCalledWith("main");
    expect(listOutbox(repo)).toEqual([]);
    await expect(ex.retry({ kind: "retry", level: "L2", summary: "?", scope }, { kind: "ops.unknown", at: 1, scope })).rejects.toThrow(/没有 ops.unknown 的重试执行器/);
    rmSync(repo, { recursive: true, force: true });
  });

  it("kunpeng duty tick --dry 已注册、有用法、在空仓里跑出零事件；非 tick 退出码 1", async () => {
    const repo = mkdtempSync(join(tmpdir(), "kp-duty-cli-"));
    mkdirSync(join(repo, ".kunpeng"), { recursive: true });
    writeFileSync(join(repo, ".kunpeng", "project.json"), JSON.stringify({ id: "demo", name: "Demo", registeredAt: 1 }));
    const savedState = process.env.KUNPENG_STATE;
    process.env.KUNPENG_STATE = mkdtempSync(join(tmpdir(), "kp-duty-global-"));
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => { out.push(line); });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const command = listCliCommands().find((c) => c.name === "duty");
    expect(command?.usage).toMatch(/^用法: kunpeng duty tick/);
    await command!.run({ repoRoot: repo, rest: ["tick", "--dry"] } as never);
    expect(out.join("\n")).toContain("[duty] 事件 0 条");
    // --repo 必须真的切到别的仓库：另一个仓里有一条宿主已死的 running 流，从 /nowhere 调用也要查到 1 条 flow.ghost。
    const other = mkdtempSync(join(tmpdir(), "kp-duty-other-"));
    mkdirSync(join(other, ".kunpeng", "state"), { recursive: true });
    writeFileSync(join(other, ".kunpeng", "project.json"), JSON.stringify({ id: "other", name: "Other", registeredAt: 1 }));
    writeFileSync(join(other, ".kunpeng", "state", "ghost-1.json"), JSON.stringify({ flowId: "ghost-1", requirement: "r", stage: "implement", status: "running", agentActive: true, pid: 2_147_483_000, history: [], createdAt: 1, updatedAt: 1 }));
    out.length = 0;
    await command!.run({ repoRoot: "/nowhere", rest: ["tick", "--repo", other, "--dry"] } as never);
    expect(out.join("\n")).toContain("[duty] 事件 1 条");
    expect(out.join("\n")).toContain('dry-run flow.ghost {"projectId":"other","flowId":"ghost-1"}');
    rmSync(other, { recursive: true, force: true });
    await command!.run({ repoRoot: repo, rest: [] } as never);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    rmSync(process.env.KUNPENG_STATE, { recursive: true, force: true });
    if (savedState === undefined) delete process.env.KUNPENG_STATE; else process.env.KUNPENG_STATE = savedState;
    rmSync(repo, { recursive: true, force: true });
  });
});