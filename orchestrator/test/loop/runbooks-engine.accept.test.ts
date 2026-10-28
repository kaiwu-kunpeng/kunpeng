import { describe, expect, it } from "vitest";
import { RUNBOOK_CATALOG, RUNBOOK_EVENT_KINDS } from "../../src/loop/runbooks/catalog.js";
import {
  EPISODE_MAX_RUNS, EPISODE_WINDOW_MS, RUNBOOK_MAX_LEVEL, episodeKey, levelAtMost, planDuty, runFromDecision, scopeWithin, summarizeActions,
} from "../../src/loop/runbooks/engine.js";
import { RUNBOOK_ACTION_KINDS, type Runbook, type RunbookEvent, type RunbookRun } from "../../src/loop/runbooks/types.js";

// 背景（2026-10-03 运营审计 A4 #1，总报告 P1-12）：鲲鹏没有 runbook 代码，熔断/对账/回收/健康各自为政，十余条处置是 memory 里的人工 SOP。
// 本测试锁定处置手册引擎的纯决策层：五类白名单动作；动作范围 ⊆ 事件范围；全局 L2 封顶；同 episode 72h 内最多处置 3 次；
// 冷却期不重复；无匹配 / 多匹配 / 空动作 / 越级 / 越范围一律转人（fail-closed）；首批六条手册的声明与计划合规。

const ev = (kind: string, scope: RunbookEvent["scope"] = { projectId: "demo", flowId: "f1" }, detail?: Record<string, unknown>): RunbookEvent => ({ kind, at: 1_000, scope, ...(detail ? { detail } : {}) });
const rb = (over: Partial<Runbook>): Runbook => ({
  id: "rb-x", rev: 1, title: "x", maxLevel: "L2", cooldownMs: 3_600_000,
  appliesTo: (e) => e.kind === "x", plan: (e) => [{ kind: "notify", level: "L1", summary: "s", scope: e.scope }], ...over,
});
const executed = (at: number, runbookId = "rb-x", key = episodeKey(ev("x"))): RunbookRun => ({ at, episodeKey: key, eventKind: "x", runbookId, rev: 1, outcome: "executed" });

describe("处置手册引擎（作者锁定）", () => {
  it("常量：五类动作、72h/3 次、全局封顶 L2；episodeKey 稳定、范围键排序、空值忽略；scopeWithin 子集语义", () => {
    expect(RUNBOOK_ACTION_KINDS).toEqual(["stop", "degrade", "retry", "notify", "draft"]);
    expect(EPISODE_WINDOW_MS).toBe(72 * 3_600_000);
    expect(EPISODE_MAX_RUNS).toBe(3);
    expect(RUNBOOK_MAX_LEVEL).toBe("L2");
    expect(episodeKey({ kind: "k", scope: { loopId: "l", projectId: "p", flowId: undefined, playbookId: "" } })).toBe("k|loopId=l|projectId=p");
    expect(levelAtMost("L2", "L2")).toBe(true);
    expect(levelAtMost("L3", "L2")).toBe(false);
    expect(scopeWithin({ flowId: "f1" }, { projectId: "demo", flowId: "f1" })).toBe(true);
    expect(scopeWithin({ flowId: "f2" }, { projectId: "demo", flowId: "f1" })).toBe(false);
    expect(scopeWithin({ loopId: "l" }, { projectId: "demo" })).toBe(false);
  });

  it("planDuty：无匹配 / 多匹配 / 空动作 / 越级 / 越范围 → escalate 并带原因", () => {
    expect(planDuty(ev("y"), [rb({})], [], 2_000)).toMatchObject({ action: "escalate", reason: "无匹配手册（y）" });
    expect(planDuty(ev("x"), [rb({ id: "a" }), rb({ id: "b" })], [], 2_000)).toMatchObject({ action: "escalate", reason: "多手册命中：a/b" });
    expect(planDuty(ev("x"), [rb({ plan: () => [] })], [], 2_000)).toMatchObject({ action: "escalate", reason: "手册未给出动作", runbookId: "rb-x" });
    expect(planDuty(ev("x"), [rb({ maxLevel: "L4", plan: (e) => [{ kind: "stop", level: "L3", summary: "s", scope: e.scope }] })], [], 2_000)).toMatchObject({ action: "escalate", reason: expect.stringContaining("动作越级：stop L3") });
    expect(planDuty(ev("x"), [rb({ maxLevel: "L1", plan: (e) => [{ kind: "stop", level: "L2", summary: "s", scope: e.scope }] })], [], 2_000)).toMatchObject({ action: "escalate", reason: expect.stringContaining("动作越级") });
    expect(planDuty(ev("x"), [rb({ plan: () => [{ kind: "stop", level: "L2", summary: "别的流", scope: { flowId: "f2" } }] })], [], 2_000)).toMatchObject({ action: "escalate", reason: expect.stringContaining("动作越出事件范围") });
  });

  it("planDuty：执行 / 冷却 / 预算用尽；台账行形状", () => {
    const run = planDuty(ev("x"), [rb({})], [], 2_000);
    expect(run).toMatchObject({ action: "execute", episodeKey: "x|flowId=f1|projectId=demo" });
    expect(runFromDecision(ev("x"), run, 2_000)).toEqual({ at: 2_000, episodeKey: "x|flowId=f1|projectId=demo", eventKind: "x", runbookId: "rb-x", rev: 1, outcome: "executed", detail: "notify:s" });
    const cool = planDuty(ev("x"), [rb({})], [executed(1_000)], 1_000 + 60_000);
    expect(cool).toEqual({ action: "cooldown", episodeKey: "x|flowId=f1|projectId=demo", runbookId: "rb-x", until: 1_000 + 3_600_000 });
    expect(runFromDecision(ev("x"), cool, 5_000).outcome).toBe("cooldown");
    const again = planDuty(ev("x"), [rb({})], [executed(1_000)], 1_000 + 3_600_000);
    expect(again.action).toBe("execute");
    const now = 100 * 3_600_000;
    const spent = [executed(now - 70 * 3_600_000, "rb-other"), executed(now - 40 * 3_600_000, "rb-other"), executed(now - 10 * 3_600_000)];
    expect(planDuty(ev("x"), [rb({})], spent, now)).toMatchObject({ action: "escalate", reason: "episode 预算用尽：72h 内已处置 3 次" });
    const aged = [executed(now - 80 * 3_600_000, "rb-other"), ...spent.slice(1)];
    expect(planDuty(ev("x"), [rb({ cooldownMs: 1 })], aged, now).action).toBe("execute");
    expect(runFromDecision(ev("x"), planDuty(ev("y"), [rb({})], [], now), now)).toMatchObject({ outcome: "escalated", detail: "无匹配手册（y）" });
    expect(summarizeActions([{ kind: "retry", level: "L2", summary: "r", scope: {} }])).toBe("[L2] retry: r");
  });
});

describe("首批六条手册（作者锁定）", () => {
  const kinds = Object.values(RUNBOOK_EVENT_KINDS);
  it("六条 id 唯一、每条 maxLevel ≤ L2、每种事件恰命中一条、计划动作全部在范围内且不越级", () => {
    expect(RUNBOOK_CATALOG.map((r) => r.id)).toEqual(["rb-ops-paused", "rb-ops-missed", "rb-flow-ghost", "rb-merge-guard-red", "rb-outbox-push", "rb-backend-down"]);
    expect(kinds).toHaveLength(6);
    for (const r of RUNBOOK_CATALOG) expect(levelAtMost(r.maxLevel, "L2"), r.id).toBe(true);
    for (const kind of kinds) {
      const e = ev(kind, { projectId: "demo", flowId: "f1", loopId: "l1", playbookId: "pb" });
      expect(RUNBOOK_CATALOG.filter((r) => r.appliesTo(e)).map((r) => r.id), kind).toHaveLength(1);
      const d = planDuty(e, RUNBOOK_CATALOG, [], 5_000);
      expect(d.action, kind).toBe("execute");
      if (d.action === "execute") for (const a of d.actions) expect(RUNBOOK_ACTION_KINDS).toContain(a.kind);
    }
    expect(planDuty(ev("ops.unknown"), RUNBOOK_CATALOG, [], 5_000).action).toBe("escalate");
  });

  it("重试类手册：第一次 retry（L2），已重试过改为 notify 转人；暂停/后端手册只 L1 不动手", () => {
    const first = planDuty(ev(RUNBOOK_EVENT_KINDS.mergeGuardRed), RUNBOOK_CATALOG, [], 5_000);
    expect(first.action === "execute" && first.actions.map((a) => a.kind)).toEqual(["retry"]);
    const second = planDuty(ev(RUNBOOK_EVENT_KINDS.mergeGuardRed, { projectId: "demo", flowId: "f1" }, { retries: 1 }), RUNBOOK_CATALOG, [], 5_000);
    expect(second.action === "execute" && second.actions.map((a) => a.kind)).toEqual(["notify"]);
    for (const kind of [RUNBOOK_EVENT_KINDS.opsMissed, RUNBOOK_EVENT_KINDS.outboxPushFailed]) {
      const d = planDuty(ev(kind, { projectId: "demo", flowId: "f1", playbookId: "pb" }, { retries: 2 }), RUNBOOK_CATALOG, [], 5_000);
      expect(d.action === "execute" && d.actions.every((a) => a.kind === "notify"), kind).toBe(true);
    }
    for (const kind of [RUNBOOK_EVENT_KINDS.opsPaused, RUNBOOK_EVENT_KINDS.backendDown]) {
      const d = planDuty(ev(kind, { projectId: "demo", flowId: "f1", playbookId: "pb" }), RUNBOOK_CATALOG, [], 5_000);
      expect(d.action === "execute" && d.actions.every((a) => a.level === "L1" && a.kind !== "retry" && a.kind !== "stop"), kind).toBe(true);
    }
    const ghost = planDuty(ev(RUNBOOK_EVENT_KINDS.flowGhost), RUNBOOK_CATALOG, [], 5_000);
    expect(ghost.action === "execute" && ghost.actions[0]).toMatchObject({ kind: "stop", level: "L2" });
  });
});