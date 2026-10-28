import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/cli-commands/reports.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import { classifyFailureText } from "../../src/loop/rollback-attribution.js";
import {
  KIND_CATEGORY, ROLLBACK_CATEGORIES, attributeFlow, buildRollbackCategoryStats, categorizeKind, formatRollbackCategoryReport, hasStageTimeout,
} from "../../src/metrics/rollback-category.js";
import { FlowTracker, type FlowState } from "../../src/runtime/flowstate.js";

// 背景（2026-08-18 审计「79.9% 回滚无归因」；2026-10-05 盘点：83 条 rolled-back 里 29 条没有 rollback 落账，其中
// `[abandoned] …raise-blocker…`、`dev-cycle 异常:`、`[loop-wave-unverified]`、`spec 阶段产出疑似登录失败`、
// `[dispatch-slot-timeout]`、无文本只有 history crashed / 某阶段恰 600s 的，全部落 unknown）。本测试锁定：
// ① 失败文本新增五类 kind 的确定性规则；② kind → 固定归因枚举（spec-defect/gate-defect/env-defect/implement-failed/
// timeout/abandoned/unknown）；③ attributeFlow 的信号优先级 rollback → 文本 → history 结构 → unknown；
// ④ 窗口统计与 unknown 占比；⑤ `kunpeng gate-stats` 真跑后输出带【回滚归因】段。夹具取自真实状态文件形态（已中性化）。

const dirs: string[] = [];
let savedState: string | undefined;
beforeEach(() => { savedState = process.env.KUNPENG_STATE; });
afterEach(() => {
  vi.restoreAllMocks();
  if (savedState === undefined) delete process.env.KUNPENG_STATE; else process.env.KUNPENG_STATE = savedState;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };
const H = (...pairs: [string, number][]) => pairs.map(([stage, at]) => ({ stage, at }));
function flow(id: string, patch: Partial<FlowState>): FlowState {
  return { flowId: id, requirement: id, stage: "done", status: "rolled-back", agentActive: false, startedAt: 1_000, updatedAt: 9_000, history: H(["spec", 1], ["implement", 2], ["verify", 3]), ...patch } as FlowState;
}

describe("失败文本新增 kind（作者锁定）", () => {
  it("raise-blocker / dev-cycle 异常 / loop 波次 / 垃圾 spec / 槽位超时 各归一类，旧规则不变", () => {
    expect(classifyFailureText("[abandoned] 人工放弃该流；放弃前卡点：raise-blocker: 需 spec 作者同步旧锁定测试的确认文案断言并调整 scope").kind).toBe("spec-blocker");
    expect(classifyFailureText("[abandoned] 能力档与 authz 白名单测试冲突（实现者求助正确），rev2 改为 merge 档重发").kind).toBe("spec-blocker");
    expect(classifyFailureText("[abandoned] 人工放弃该流").kind).toBe("abandoned");
    expect(classifyFailureText("dev-cycle 异常: Error: fatal: '/x/.kunpeng/wt/demo-flow-0-0'").kind).toBe("crashed");
    expect(classifyFailureText("dev-cycle 异常: Error: invalid spec author file path: /x/orchestrator/test/server/demo.test.ts").kind).toBe("audit-rejected");
    expect(classifyFailureText("[loop-wave-unverified] passed 1/3").kind).toBe("loop-wave-unverified");
    expect(classifyFailureText("spec 阶段产出疑似登录失败/空响应，拒绝当作有效 spec 继续实现").kind).toBe("garbage-spec");
    expect(classifyFailureText("[dispatch-slot-timeout] Error: 并发槽位等待超时").kind).toBe("dispatch-slot-timeout");
    expect(classifyFailureText("[dispatch-lock-conflict] 写锁被 demo-other 占用").kind).toBe("dispatch-slot-timeout");
    expect(classifyFailureText("[backend-down] 已检测 codex,claude 已标不可用").kind).toBe("dispatch-slot-timeout");
    expect(classifyFailureText("验收测试审计未通过: spec 未给出验收验证命令").kind).toBe("audit-rejected");
    expect(classifyFailureText("[verify] 评估器判定 inconclusive：评估器输出不可解析").kind).toBe("verify-evaluator");
    expect(classifyFailureText("something odd").kind).toBe("unknown");
  });
});

describe("kind → 归因枚举（作者锁定）", () => {
  it("七个固定类别；每个 kind 都有归属；评估器判不定=门缺陷、判 fail=实现失败", () => {
    expect(ROLLBACK_CATEGORIES).toEqual(["spec-defect", "gate-defect", "env-defect", "implement-failed", "timeout", "abandoned", "unknown"]);
    for (const category of Object.values(KIND_CATEGORY)) expect(ROLLBACK_CATEGORIES).toContain(category);
    expect(categorizeKind("spec-blocker")).toBe("spec-defect");
    expect(categorizeKind("not-red-first")).toBe("spec-defect");
    expect(categorizeKind("audit-rejected")).toBe("spec-defect");
    expect(categorizeKind("verify-evaluator", "[verify] 评估器判定 inconclusive：评估器输出不可解析")).toBe("gate-defect");
    expect(categorizeKind("verify-evaluator", "[verify] 评估器判定 fail：实现与明确验收契约不完全一致")).toBe("implement-failed");
    expect(categorizeKind("test-failed")).toBe("implement-failed");
    expect(categorizeKind("check-regression")).toBe("implement-failed");
    expect(categorizeKind("crashed")).toBe("env-defect");
    expect(categorizeKind("garbage-spec")).toBe("env-defect");
    expect(categorizeKind("dispatch-slot-timeout")).toBe("env-defect");
    expect(categorizeKind("worktree-contention")).toBe("env-defect");
    expect(categorizeKind("stage-timeout")).toBe("timeout");
    expect(categorizeKind("timeout")).toBe("timeout");
    expect(categorizeKind("abandoned")).toBe("abandoned");
    expect(categorizeKind("never-heard-of")).toBe("unknown");
  });
});

describe("attributeFlow 信号优先级（作者锁定）", () => {
  it("rollback 落账 > 失败文本 > history 结构（crashed / 600s 阶段）> unknown", () => {
    expect(attributeFlow(flow("a", { rollback: { kind: "test-failed", summary: "FAIL x", attempt: 2 }, failureReason: "[abandoned] 人工放弃该流" })))
      .toEqual({ kind: "test-failed", category: "implement-failed", summary: "FAIL x", signal: "rollback" });
    expect(attributeFlow(flow("b", { failureReason: "[abandoned] 人工放弃该流；放弃前卡点：raise-blocker: 需 spec 作者修订锁定断言" })))
      .toMatchObject({ kind: "spec-blocker", category: "spec-defect", signal: "text" });
    expect(attributeFlow(flow("c", { history: H(["spec", 1_000], ["crashed", 155_000], ["retired-superseded", 1_078_000]) })))
      .toEqual({ kind: "crashed", category: "env-defect", summary: "history 含 crashed 阶段", signal: "history" });
    expect(attributeFlow(flow("d", { failureReason: "something odd", history: H(["implement", 1_000_000], ["verify", 1_600_000], ["implement", 1_720_000]) })))
      .toEqual({ kind: "stage-timeout", category: "timeout", summary: "某阶段恰跑满 600s 被硬杀", signal: "history" });
    expect(attributeFlow(flow("e", { failureReason: "something odd" })))
      .toEqual({ kind: "unknown", category: "unknown", summary: "something odd", signal: "none" });
    expect(attributeFlow(flow("f", {}))).toEqual({ kind: "unknown", category: "unknown", summary: "", signal: "none" });
    expect(hasStageTimeout(H(["a", 0], ["b", 589_999]))).toBe(false);
    expect(hasStageTimeout(H(["a", 0], ["b", 600_000]))).toBe(true);
    expect(hasStageTimeout(H(["a", 0], ["b", 620_001]))).toBe(false);
  });
});

describe("窗口统计与渲染（作者锁定）", () => {
  it("只数窗口内 rolled-back/crashed；unknown 占比一位小数；渲染四行", () => {
    const flows = [
      flow("1", { rollback: { kind: "test-failed", summary: "FAIL", attempt: 1 } }),
      flow("2", { rollback: { kind: "verify-evaluator", summary: "[verify] 评估器判定 inconclusive：评估器输出不可解析", attempt: 1 } }),
      flow("3", { failureReason: "[abandoned] 人工放弃该流；放弃前卡点：raise-blocker: 需 spec 作者改 scope" }),
      flow("4", { status: "crashed", failureReason: "", blocker: "lease-expired" }),
      flow("5", { failureReason: "something odd" }),
      flow("6", { failureReason: "nothing matches", history: H(["spec", 1_000], ["implement", 601_000]) }),
      flow("old", { failureReason: "something odd", updatedAt: 100 }),
      flow("ok", { status: "verified", rollback: { kind: "test-failed", summary: "残留", attempt: 1 } }),
      flow("future", { failureReason: "something odd", updatedAt: 50_000 }),
    ];
    const stats = buildRollbackCategoryStats(flows, { sinceMs: 5_000, untilMs: 20_000 });
    expect(stats.total).toBe(6);
    expect(stats.byCategory).toEqual({ "spec-defect": 1, "gate-defect": 1, "env-defect": 1, "implement-failed": 1, timeout: 1, abandoned: 0, unknown: 1 });
    expect(stats.byKind).toEqual({ "test-failed": 1, "verify-evaluator": 1, "spec-blocker": 1, crashed: 1, unknown: 1, "stage-timeout": 1 });
    expect(stats.bySignal).toEqual({ rollback: 2, text: 2, history: 1, none: 1 });
    expect(stats.unknownPct).toBe(16.7);
    const text = formatRollbackCategoryReport(stats);
    expect(text.split("\n")).toHaveLength(4);
    expect(text).toContain("【回滚归因】窗口内回滚/崩溃 6 条 · unknown 占比 16.7%");
    expect(text).toContain("按归因：spec-defect 1；gate-defect 1；env-defect 1；implement-failed 1；timeout 1；abandoned 0；unknown 1");
    expect(text).toContain("信号来源：流内落账 2；失败文本 2；history 结构 1；无信号 1");
    expect(buildRollbackCategoryStats([], { sinceMs: 0, untilMs: 1 })).toMatchObject({ total: 0, unknownPct: 0 });
    expect(formatRollbackCategoryReport(buildRollbackCategoryStats([], { sinceMs: 0, untilMs: 1 }))).toContain("按细类：无");
  });
});

describe("kunpeng gate-stats 真跑（作者锁定）", () => {
  it("门账本之后紧跟【回滚归因】段，unknown 占比来自真实状态文件", async () => {
    process.env.KUNPENG_STATE = tmp("kp-attrib-state-");
    const repoRoot = tmp("kp-attrib-repo-");
    execFileSync("git", ["init", "-q", repoRoot], { stdio: ["ignore", "pipe", "pipe"] });
    const tracker = new FlowTracker(join(repoRoot, ".kunpeng", "state"));
    await tracker.start("demo-rb-1", "demo 1");
    await tracker.finish("demo-rb-1", "rolled-back", undefined, "[abandoned] 人工放弃该流；放弃前卡点：raise-blocker: 需作者改 spec");
    await tracker.start("demo-rb-2", "demo 2");
    await tracker.finish("demo-rb-2", "rolled-back", undefined, "something odd");
    await tracker.start("demo-ok", "demo ok");
    await tracker.finish("demo-ok", "verified");
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => { out.push(line); });
    const command = listCliCommands().find((c) => c.name === "gate-stats")!;
    await command.run({ repoRoot, rest: ["--days", "21"], argv: ["gate-stats", "--days", "21"], flags: new Set<string>() } as never);
    const text = out.join("\n");
    expect(text.indexOf("【门账本")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("【回滚归因】")).toBeGreaterThan(text.indexOf("【门账本"));
    expect(text).toContain("窗口内回滚/崩溃 2 条 · unknown 占比 50%");
    expect(text).toContain("spec-defect 1；");
  });
});