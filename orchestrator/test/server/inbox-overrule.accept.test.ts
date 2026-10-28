import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/server/routes/gate-actions.js";
import "../../src/server/routes/gates.js";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import {
  buildOverruleProposal, detectOverrule, fileMergeOverruleIfAny, overruleLedgerPath, triageMergeFlow, type OverruleRecord,
} from "../../src/server/inbox-overrule.js";
import { listModularRoutes } from "../../src/server/routes/registry.js";

// 背景（2026-10-03 运营审计 A4 #3，总报告 P1-10 第二步；开悟 #3「改判弹提案」）：人推翻机器把握（批了「不该办」/驳了「能办」）
// 是最值钱的训练信号，今天被静默吞掉。本测试锁定：改判判定；合并门流按聚合口径重算把握；改判落 append-only 账本并起草
// 进化提案草稿（kind proposal / status draft，止于人工门 #2，不自动固化）；/api/merge 与 /api/gates/discard 两条路由接上且 best-effort。

const record = (over: Partial<OverruleRecord> = {}): OverruleRecord => ({ at: 1_700_000_000_000, kind: "approved-shouldnt", itemKind: "merge", itemId: "f-x", via: "cockpit-merge", triage: { origin: "pre-review-reject", triggeredBy: "ai", confidence: "shouldnt" }, ...over });

describe("改判判定与提案草稿（作者锁定）", () => {
  it("detectOverrule 只认两种改判；triageMergeFlow 按聚合口径：human tier→L3 拿不准，预审 reject→不该办，auto+approve→能办", () => {
    expect(detectOverrule("shouldnt", "approve")).toBe("approved-shouldnt");
    expect(detectOverrule("can", "reject")).toBe("rejected-can");
    expect(detectOverrule("can", "approve")).toBeUndefined();
    expect(detectOverrule("unsure", "reject")).toBeUndefined();
    expect(detectOverrule(undefined, "approve")).toBeUndefined();
    const gate = { gate: "合并主干", what: "kp/f → main" };
    expect(triageMergeFlow({ flowId: "f", humanGate: { ...gate, preReview: { verdict: "approve", reason: "ok", at: 1 } }, mergeTier: { tier: "human", reasons: ["敏感"], ruleIds: ["sensitive-path"], mode: "enforce", at: 1 } })).toMatchObject({ origin: "sensitive-path", confidence: "unsure" });
    expect(triageMergeFlow({ flowId: "f", humanGate: { ...gate, preReview: { verdict: "reject", reason: "坏", at: 1 } }, mergeTier: { tier: "auto", reasons: [], ruleIds: [], mode: "enforce", at: 1 } })).toEqual({ origin: "merge-gate", triggeredBy: "ai", confidence: "shouldnt" });
    expect(triageMergeFlow({ flowId: "f", humanGate: { ...gate, preReview: { verdict: "approve", reason: "小", at: 1 } }, mergeTier: { tier: "auto", reasons: [], ruleIds: [], mode: "enforce", at: 1 } })).toEqual({ origin: "merge-gate", triggeredBy: "rule", confidence: "can" });
    expect(triageMergeFlow({ flowId: "f", humanGate: gate })).toMatchObject({ confidence: "unsure", missing: "无预审结论（预审未跑或失败）" });
  });

  it("buildOverruleProposal：draft proposal，id 带改判种类与条目，正文三选一，meta 带完整改判记录", () => {
    const a = buildOverruleProposal(record({ who: "boss", note: "这个判官太保守" }));
    expect(a).toMatchObject({ kind: "proposal", status: "draft", id: `ovr-approved-shouldnt-f-x-${(1_700_000_000_000).toString(36)}` });
    expect(a.body).toContain("机器判「不该办」，你批准了（cockpit-merge · boss）");
    expect(a.body).toContain("人给的理由：这个判官太保守");
    for (const opt of ["1. 做成规则", "2. 禁用词", "3. 回归样例", "人工门 #2"]) expect(a.body).toContain(opt);
    expect((a.meta as { overrule: OverruleRecord }).overrule.triage.origin).toBe("pre-review-reject");
    expect(buildOverruleProposal(record({ kind: "rejected-can", via: "cockpit-discard" })).body).toContain("机器判「能办」，你驳回了（cockpit-discard）");
  });
});

describe("落账 + 起草 + 路由接线（作者锁定）", () => {
  let repo: string; let stateDir: string; let savedState: string | undefined;
  beforeEach(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    repo = mkdtempSync(join(tmpdir(), "kp-ovr-"));
    savedState = process.env.KUNPENG_STATE; process.env.KUNPENG_STATE = join(repo, "global-state");
    const g = simpleGit(repo); await g.init(); await g.addConfig("user.email", "t@t").addConfig("user.name", "t");
    await g.checkoutLocalBranch("main"); writeFileSync(join(repo, "a.txt"), "a"); await g.add("a.txt"); await g.commit("base");
    stateDir = join(repo, ".kunpeng", "state");
  });
  afterEach(() => { vi.restoreAllMocks(); if (savedState === undefined) delete process.env.KUNPENG_STATE; else process.env.KUNPENG_STATE = savedState; rmSync(repo, { recursive: true, force: true }); });
  const mkReq = (body: unknown) => { const r = new EventEmitter() as EventEmitter & { headers: Record<string, string> }; r.headers = {}; setTimeout(() => { r.emit("data", Buffer.from(JSON.stringify(body))); r.emit("end"); }, 10); return r as never; };
  const mkRes = () => { const out: string[] = []; return { out, res: { statusCode: 200, setHeader() {}, end(s?: string) { if (s) out.push(s); } } as never }; };
  const route = (path: string) => listModularRoutes().find((r) => r.method === "POST" && r.path === path)!;

  it("fileMergeOverruleIfAny：无改判返回 undefined 不落账；有改判 → 账本一行 + draft proposal 入 ArtifactStore", async () => {
    const flowOk = { flowId: "f-can", humanGate: { gate: "g", what: "w", preReview: { verdict: "approve", reason: "小", at: 1 } }, mergeTier: { tier: "auto" as const, reasons: [], ruleIds: [], mode: "enforce" as const, at: 1 } };
    expect(await fileMergeOverruleIfAny({ repoRoot: repo, stateDir, flow: flowOk, decision: "approve", via: "cockpit-merge", now: 5 })).toBeUndefined();
    expect(await fileMergeOverruleIfAny({ repoRoot: repo, stateDir, flow: null, decision: "reject", via: "x", now: 5 })).toBeUndefined();
    const id = await fileMergeOverruleIfAny({ repoRoot: repo, stateDir, flow: flowOk, decision: "reject", via: "cockpit-discard", who: "boss", projectId: "demo", now: 5 });
    expect(id).toBe("ovr-rejected-can-f-can-5");
    const ledger = readFileSync(overruleLedgerPath(stateDir), "utf8").trim().split("\n").map((l) => JSON.parse(l) as OverruleRecord);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ kind: "rejected-can", itemId: "f-can", who: "boss", projectId: "demo", via: "cockpit-discard", triage: { confidence: "can" } });
    const drafts = await new ArtifactStore(join(repo, ".kunpeng", "artifacts")).list("proposal");
    expect(drafts.map((a) => [a.id, a.status])).toEqual([["ovr-rejected-can-f-can-5", "draft"]]);
  });

  it("/api/gates/discard 驳了「能办」的门 → 门清 + 起草；/api/merge 批了「不该办」的门 → 合并结果里带 overruleProposal", async () => {
    const tracker = new FlowTracker(stateDir);
    await tracker.start("f-can", "r"); await tracker.finish("f-can", "verified", { gate: "合并主干 (人工门#1)", what: "kp/f-can → main" });
    await tracker.setGatePreReview("f-can", { verdict: "approve", reason: "小", at: 1 });
    writeFileSync(join(repo, ".kunpeng", "project.json"), JSON.stringify({ id: "demo", name: "Demo", registeredAt: 1 }));
    const ctx = { repoRoot: repo, stateDir: process.env.KUNPENG_STATE! };
    const d = mkRes();
    await route("/api/gates/discard").handle(mkReq({ flowId: "f-can" }), d.res, "/api/gates/discard", ctx);
    expect(JSON.parse(d.out[0]!)).toEqual({ ok: true });
    expect((await tracker.read("f-can"))?.humanGate).toBeUndefined();
    let drafts = await new ArtifactStore(join(repo, ".kunpeng", "artifacts")).list("proposal");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.id).toMatch(/^ovr-rejected-can-f-can-/);

    const g = simpleGit(repo);
    await g.checkoutLocalBranch("kp/f-no"); writeFileSync(join(repo, "b.txt"), "b"); await g.add("b.txt"); await g.commit("feat"); await g.checkout("main");
    await tracker.start("f-no", "r"); await tracker.finish("f-no", "verified", { gate: "合并主干 (人工门#1)", what: "kp/f-no → main" });
    await tracker.setGatePreReview("f-no", { verdict: "reject", reason: "改坏了", at: 1 });
    const m = mkRes();
    await route("/api/merge").handle(mkReq({ projectId: "demo", flowId: "f-no", target: "main" }), m.res, "/api/merge", ctx);
    const body = JSON.parse(m.out[0]!) as { ok: boolean; note?: string; overruleProposal?: string; error?: string };
    expect(body.ok, body.error).toBe(true);
    expect(body.overruleProposal).toMatch(/^ovr-approved-shouldnt-f-no-/);
    expect(body.note).toContain("已起草改判提案");
    drafts = await new ArtifactStore(join(repo, ".kunpeng", "artifacts")).list("proposal");
    expect(drafts.map((a) => a.id.split("-").slice(0, 3).join("-")).sort()).toEqual(["ovr-approved-shouldnt", "ovr-rejected-can"]);
    expect(readFileSync(overruleLedgerPath(stateDir), "utf8").trim().split("\n")).toHaveLength(2);
  });
});