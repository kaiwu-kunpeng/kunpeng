// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { INBOX_LANES, confidenceLabel, groupByLane, laneOf, originLabel, triageReviewItem } from "../../src/server/inbox-triage.js";
import { aggregateReviewQueue, type DashboardState, type ProjectSnapshot, type ReviewItem } from "../../src/server/state.js";
import { renderReviewInbox } from "../../src/server/ui/views/review-inbox.js";

// 背景（2026-10-03 运营审计 A4 #3，总报告 P1-10；开悟 #3）：收件箱条目没有「为什么到你这里」、没有触发方、没有机器的把握，
// 人对每一条都得从头读。本测试锁定：triage 纯判定（来由 / 触发方 / 把握三档 / 拿不准必带还缺）；聚合末尾给每条算 triage
// （合并门来由取 mergeTier.ruleIds[0]，过期→拿不准）；视图把每个分区的条目按三栏渲染，并在真 DOM 里能按栏查到卡片与徽标。

const base = (over: Partial<ReviewItem>): ReviewItem => ({ projectId: "p", projectName: "P", kind: "merge", id: "f", title: "t", detail: "d", ...over });

describe("triage 纯判定（作者锁定）", () => {
  it("三栏常量；预审 approve 的 L2 合并→能办；review→拿不准带预审理由；无预审→拿不准；reject 或带 normal 发现→不该办且 AI 触发", () => {
    expect(INBOX_LANES.map((l) => [l.id, l.confidence])).toEqual([["release", "can"], ["judge", "unsure"], ["reject", "shouldnt"]]);
    expect(["can", "unsure", "shouldnt"].map((c) => laneOf(c as "can"))).toEqual(["release", "judge", "reject"]);
    expect(["can", "unsure", "shouldnt"].map((c) => confidenceLabel(c as "can"))).toEqual(["能办", "拿不准", "不该办"]);
    const l2 = { action: "merge-main", blastRadius: "L2" as const };
    expect(triageReviewItem(base({ decision: l2, preReview: { verdict: "approve", reason: "小", at: 1 } }))).toEqual({ origin: "merge-gate", triggeredBy: "rule", confidence: "can" });
    expect(triageReviewItem(base({ decision: l2, preReview: { verdict: "review", reason: "diff 太大", at: 1 } }), { ruleIds: ["large-diff", "public-surface"] })).toEqual({ origin: "large-diff", triggeredBy: "rule", confidence: "unsure", missing: "预审拿不准：diff 太大" });
    expect(triageReviewItem(base({ decision: l2 }))).toMatchObject({ confidence: "unsure", missing: "无预审结论（预审未跑或失败）" });
    expect(triageReviewItem(base({ decision: l2, preReview: { verdict: "reject", reason: "坏", at: 1 } }))).toEqual({ origin: "merge-gate", triggeredBy: "ai", confidence: "shouldnt" });
    expect(triageReviewItem(base({ decision: l2, preReview: { verdict: "approve", reason: "矛盾", at: 1, findings: { normal: [{ file: "a.ts", line: 1, issue: "i", evidence: "e" }], nit: [], pre_existing: [] } } }))).toMatchObject({ triggeredBy: "ai", confidence: "shouldnt" });
  });

  it("硬门 / 提案 / 发布 / connector / 运营门 / 过期 / 通知类 全部拿不准且各有「还缺」；来由标签表覆盖合并门规则 id", () => {
    expect(triageReviewItem(base({ decision: { action: "merge-main", blastRadius: "L3" }, preReview: { verdict: "approve", reason: "ok", at: 1 } }), { ruleIds: ["sensitive-path"] })).toEqual({ origin: "sensitive-path", triggeredBy: "rule", confidence: "unsure", missing: "L3 对外可见，属 C5 第三类，须人工确认" });
    expect(triageReviewItem(base({ kind: "proposal", decision: { action: "approve-apply", blastRadius: "L3" }, preReview: { verdict: "approve", reason: "ok", at: 1 } }))).toMatchObject({ origin: "proposal", confidence: "unsure", missing: expect.stringContaining("人工门 #2") });
    for (const kind of ["release", "connector", "ops-gate"] as const) expect(triageReviewItem(base({ kind, decision: { action: "x", blastRadius: "L4" } })), kind).toMatchObject({ origin: kind, confidence: "unsure", missing: expect.stringContaining("C5 第三类") });
    expect(triageReviewItem(base({ decision: { action: "merge-main", blastRadius: "L2", expired: true }, preReview: { verdict: "approve", reason: "ok", at: 1 } }))).toMatchObject({ confidence: "unsure", missing: expect.stringContaining("已过期") });
    for (const kind of ["failed", "blocked", "alert", "budget"] as const) expect(triageReviewItem(base({ kind })), kind).toMatchObject({ origin: kind, triggeredBy: "rule", confidence: "unsure", missing: expect.stringContaining("机器只报不判") });
    expect(originLabel("sensitive-path")).toBe("敏感路径");
    expect(originLabel("guard-red")).toBe("守门碰红");
    expect(originLabel("merge-gate")).toContain("C5#1");
    expect(originLabel("custom-x")).toBe("custom-x");
    expect(groupByLane([base({ triage: { origin: "merge-gate", triggeredBy: "rule", confidence: "can" } }), base({ id: "g" })]).map((g) => [g.lane.id, g.items.map((i) => i.id)])).toEqual([["release", ["f"]], ["judge", ["g"]]]);
  });
});

describe("聚合给每条算 triage（作者锁定）", () => {
  const snap = (id: string, state: unknown): ProjectSnapshot => ({ id, name: `项目${id}`, repoPath: `/tmp/${id}`, state } as unknown as ProjectSnapshot);
  it("合并门来由取 mergeTier.ruleIds[0]；预审 approve 的 auto 流→能办；过期门→拿不准；通知类也有 triage", () => {
    const now = 10 * 24 * 3_600_000;
    const q = aggregateReviewQueue([snap("a", {
      humanGates: [
        { flowId: "f-sens", what: "合并主干 kp/f-sens → main", detail: "d", preReview: { verdict: "approve", reason: "小", at: 1 } },
        { flowId: "f-ok", what: "合并主干 kp/f-ok → main", detail: "d", preReview: { verdict: "approve", reason: "小", at: 1 } },
        { flowId: "f-old", what: "合并主干 kp/f-old → main", detail: "d", preReview: { verdict: "approve", reason: "小", at: 1 } },
      ],
      flows: [
        { flowId: "f-sens", status: "verified", stage: "done", mergeTier: { tier: "human", reasons: ["敏感"], ruleIds: ["sensitive-path"], mode: "enforce", at: 1 } },
        { flowId: "f-ok", status: "verified", stage: "done", mergeTier: { tier: "auto", reasons: [], ruleIds: [], mode: "enforce", at: 1 } },
        { flowId: "f-old", status: "verified", stage: "done", gateOpenedAt: 0, mergeTier: { tier: "auto", reasons: [], ruleIds: [], mode: "enforce", at: 1 } },
        { flowId: "dead", requirement: "崩", status: "crashed", blocker: "OOM", updatedAt: now - 1_000 },
      ],
      health: { alerts: [], running: 0, healthy: 0 },
    })], { now, policy: { dailyHardCapPerProject: 5, gateTtlHours: 1 } });
    const by = (id: string) => q.find((i) => i.id === id)!;
    expect(by("f-sens").triage).toMatchObject({ origin: "sensitive-path", confidence: "unsure" });
    expect(by("f-ok").triage).toEqual({ origin: "merge-gate", triggeredBy: "rule", confidence: "can" });
    expect(by("f-old").triage).toMatchObject({ confidence: "unsure", missing: expect.stringContaining("已过期") });
    expect(by("dead").triage).toMatchObject({ origin: "failed", confidence: "unsure" });
    expect(q.every((i) => i.triage !== undefined)).toBe(true);
  });
});

describe("视图三栏（作者锁定，真 DOM）", () => {
  function state(overrides: Partial<DashboardState>): DashboardState {
    return {
      agents: 0, flows: [], running: [], blockers: [], humanGates: [], artifacts: {}, branches: [], statusCounts: {},
      systemLight: "green", agentAssignments: [], patrol: { pendingCount: 0, lastRunText: "尚未巡检" }, plans: [],
      code: { srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0 },
      designCandidates: [], health: { alerts: [], running: 0, healthy: 0 },
      ...overrides,
    } as DashboardState;
  }
  it("卡片落在各自的栏里、栏按放行/判断/驳回排序且空栏不渲染；徽标带来由与触发方；拿不准卡片写出还缺", () => {
    document.body.innerHTML = renderReviewInbox(state({
      reviewQueue: [
        base({ id: "f-can", decision: { action: "merge-main", blastRadius: "L2" }, triage: { origin: "merge-gate", triggeredBy: "rule", confidence: "can" } }),
        base({ id: "f-no", decision: { action: "merge-main", blastRadius: "L2" }, preReview: { verdict: "reject", reason: "坏", at: 1 }, triage: { origin: "pre-review-reject", triggeredBy: "ai", confidence: "shouldnt" } }),
        base({ id: "f-hmm", decision: { action: "merge-main", blastRadius: "L3" }, triage: { origin: "sensitive-path", triggeredBy: "rule", confidence: "unsure", missing: "L3 对外可见，属 C5 第三类，须人工确认" } }),
        base({ id: "f-raw", decision: { action: "merge-main", blastRadius: "L2" } }),
      ],
    }));
    const lanes = [...document.querySelectorAll("[data-kp-lane]")].map((el) => el.getAttribute("data-kp-lane"));
    expect(lanes).toEqual(["release", "judge", "reject"]);
    const idsIn = (lane: string) => [...document.querySelectorAll(`[data-kp-lane="${lane}"] [data-kp-inbox-item]`)].map((el) => el.getAttribute("data-kp-inbox-id"));
    expect(idsIn("release")).toEqual(["merge:f-can"]);
    expect(idsIn("reject")).toEqual(["merge:f-no"]);
    expect(idsIn("judge").sort()).toEqual(["merge:f-hmm", "merge:f-raw"]);
    expect(document.querySelector('[data-kp-lane="judge"] [data-kp-lane-title]')?.textContent).toBe("需要你判断 · 2");
    const hmm = document.querySelector('[data-kp-inbox-id="merge:f-hmm"]')!;
    expect(hmm.querySelector('[data-kp-origin="sensitive-path"]')?.textContent).toBe("来由 · 敏感路径");
    expect(hmm.querySelector("[data-kp-trigger]")?.getAttribute("data-kp-trigger")).toBe("rule");
    expect(hmm.querySelector('[data-kp-confidence="unsure"]')?.textContent).toBe("把握：拿不准 · 还缺：L3 对外可见，属 C5 第三类，须人工确认");
    const no = document.querySelector('[data-kp-inbox-id="merge:f-no"]')!;
    expect(no.querySelector("[data-kp-trigger]")?.textContent).toBe("AI 触发");
    expect(no.querySelector('[data-kp-confidence="shouldnt"]')?.textContent).toBe("把握：不该办");
    expect(document.querySelector('[data-kp-inbox-id="merge:f-raw"] [data-kp-confidence]')).toBeNull();
    expect(document.querySelectorAll('[data-kp-inbox-id="merge:f-can"] button[data-action="merge-main"]')).toHaveLength(1);
  });
  it("空队列不渲染任何栏", () => {
    document.body.innerHTML = renderReviewInbox(state({ reviewQueue: [] }));
    expect(document.querySelectorAll("[data-kp-lane]")).toHaveLength(0);
    expect(document.body.textContent).toContain("暂无待处理的门");
  });
});