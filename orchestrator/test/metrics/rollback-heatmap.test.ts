import { describe, expect, it } from "vitest";
import type { FlowState } from "../../src/runtime/flowstate.js";
import { attributionFor, buildRollbackHeatmap, deriveBackend, deriveFailureStage, renderHeatmapText } from "../../src/metrics/rollback-heatmap.js";

function flow(id: string, patch: Partial<FlowState>): FlowState {
  return {
    flowId: id, requirement: id, stage: "done", status: "rolled-back", agentActive: false,
    pid: 1, host: "h", startedAt: 1_000, updatedAt: 9_000, backend: "codex",
    history: [{ stage: "spec", at: 1 }, { stage: "audit", at: 2 }, { stage: "implement", at: 3 }, { stage: "verify", at: 4 }],
    ...patch,
  } as FlowState;
}
const H = (...stages: string[]) => stages.map((stage, i) => ({ stage, at: i + 1 }));

const FLOWS: FlowState[] = [
  flow("tf-1", { rollback: { kind: "test-failed", summary: "FAIL", attempt: 2 }, stageBackends: { spec: "claude", implement: "codex", repair: "codex" } }),
  flow("tf-2", { rollback: { kind: "test-failed", summary: "FAIL", attempt: 1 }, backend: "claude", stageBackends: { verify: "claude" } }),
  flow("wt-1", { failureReason: "dev-cycle 异常: Error: Preparing worktree (new branch 'kp/w')\nfatal: 'kp/w' is already checked out", history: H("spec"), backend: undefined, stageBackends: {} }),
  flow("au-1", { failureReason: "验收测试审计未通过: vitest 命令点名的测试文件不存在: a.test.ts", history: H("spec", "audit") }),
  flow("cr-1", { failureReason: "[retired-superseded] 崩溃流分支 kp/c 已被主干吸收或已不存在，自动退役；崩溃时卡点：主人进程已崩溃（启动时判定）", history: H("spec", "implement", "crashed", "retired-superseded") }),
  flow("ab-1", { failureReason: "[abandoned] 人工放弃该流", history: H("spec", "implement", "abandoned") }),
  flow("cg-1", { failureReason: "项目检查 [cd orchestrator && npm run test:unit] 引入基线之外的新问题:\n × x" }),
  flow("un-1", { failureReason: "something odd" }),
  flow("none-1", {}),
  flow("old-1", { rollback: { kind: "timeout", summary: "t", attempt: 1 }, updatedAt: 100 }),
  flow("ok-1", { status: "verified", rollback: { kind: "test-failed", summary: "残留", attempt: 1 } }),
  flow("stop-1", { status: "stopped", failureReason: "暂停" }),
  flow("crash-2", { status: "crashed", failureReason: "lease-expired", blocker: "lease-expired", history: H("spec", "implement", "crashed") }),
];

describe("回滚热图（作者锁定）", () => {
  it("阶段从 history 末尾的真实阶段推出；后端按阶段取，缺省回落流级", () => {
    expect(deriveFailureStage(FLOWS[0]!)).toBe("verify");
    expect(deriveFailureStage(FLOWS[4]!)).toBe("implement");
    expect(deriveFailureStage({ history: [], stage: "done" })).toBe("unknown");
    expect(deriveBackend(FLOWS[0]!, "implement")).toBe("codex");
    expect(deriveBackend(FLOWS[1]!, "verify")).toBe("claude");
    expect(deriveBackend(FLOWS[2]!, "spec")).toBe("unknown");
  });

  it("attributionFor：优先结构化 rollback，其次自由文本归类，最后 unknown", () => {
    expect(attributionFor(FLOWS[0]!)).toEqual({ kind: "test-failed", summary: "FAIL", source: "rollback" });
    expect(attributionFor(FLOWS[2]!).kind).toBe("worktree-contention");
    expect(attributionFor(FLOWS[2]!).source).toBe("none");
    expect(attributionFor(FLOWS[8]!)).toEqual({ kind: "unknown", summary: "", source: "none" });
    expect(attributionFor(flow("bf", { rollback: { kind: "crashed", summary: "x", attempt: 0, source: "backfill" } })).source).toBe("backfill");
  });

  it("只统计 rolled-back/crashed 且在窗口内；覆盖率把 unknown 排除在分子外", () => {
    const h = buildRollbackHeatmap(FLOWS, { sinceMs: 5_000 });
    expect(h.coverage).toEqual({ total: 10, attributed: 8, unknown: 2, pct: 80 });
    expect(h.kinds).toEqual(["abandoned", "audit-rejected", "check-regression", "crashed", "test-failed", "unknown", "worktree-contention"]);
    expect(h.stages).toEqual(["audit", "implement", "spec", "verify"]);
    expect(h.backends).toEqual(["claude", "codex", "unknown"]);
    const tf = h.cells.filter((c) => c.kind === "test-failed");
    expect(tf.map((c) => [c.stage, c.backend, c.count])).toEqual([["verify", "claude", 1], ["verify", "codex", 1]]);
    expect(h.cells.find((c) => c.kind === "crashed" && c.stage === "implement")?.count).toBe(2);
    expect(h.cells.find((c) => c.kind === "worktree-contention")).toMatchObject({ stage: "spec", backend: "unknown", flowIds: ["wt-1"] });
    expect(h.cells[0]!.count).toBeGreaterThanOrEqual(h.cells[h.cells.length - 1]!.count);
    expect(buildRollbackHeatmap([], {}).coverage).toEqual({ total: 0, attributed: 0, unknown: 0, pct: 0 });
  });

  it("不给窗口则全量；文本渲染含覆盖率与每个 kind 一行", () => {
    const h = buildRollbackHeatmap(FLOWS);
    expect(h.coverage.total).toBe(11);
    const text = renderHeatmapText(h);
    expect(text.split("\n")[0]).toContain("回滚归因覆盖率");
    expect(text).toContain("unknown 2 不计");
    expect(text).toContain("test-failed: verify=2");
    expect(text).toContain("crashed: implement=2");
    expect(text).toContain("后端");
    expect(renderHeatmapText(buildRollbackHeatmap([], {})).split("\n")).toHaveLength(1);
  });
});