import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FlowState } from "../../src/runtime/flowstate.js";
import {
  RECURRENCE_HINTS,
  buildRecurrenceRules,
  collectRecurringRollbacks,
  hintFor,
  loadRecurrenceRules,
  recurrenceRulesPath,
  writeRecurrenceRules,
} from "../../src/metrics/rollback-recurrence.js";

// 夹具取自真实状态文件形态：rolled-back 流带 rollback{kind,summary,attempt,acceptLogPath}，老流没有 rollback 字段。
function flow(id: string, patch: Partial<FlowState>): FlowState {
  return {
    flowId: id, requirement: `req ${id}`, stage: "done", status: "rolled-back", agentActive: false,
    pid: 1, host: "h", startedAt: 1_000, updatedAt: 9_000, history: [{ stage: "spec", at: 1_000 }],
    ...patch,
  } as FlowState;
}
const FLOWS: FlowState[] = [
  flow("tf-1", { rollback: { kind: "test-failed", summary: "FAIL test/a.test.ts > x · AssertionError: expected 3 to be 4", attempt: 1, acceptLogPath: "/Users/x/kunpeng/.kunpeng/accept-logs/tf-1/1.txt" } }),
  flow("tf-2", { rollback: { kind: "test-failed", summary: "FAIL test/a.test.ts > x · AssertionError: expected 7 to be 9", attempt: 2, acceptLogPath: "/Users/x/kunpeng/.kunpeng/accept-logs/tf-2/2.txt" }, updatedAt: 9_500 }),
  flow("tf-3", { rollback: { kind: "test-failed", summary: "FAIL test/a.test.ts > x · AssertionError: expected 1 to be 2", attempt: 3 } }),
  flow("tf-4", { rollback: { kind: "test-failed", summary: "FAIL test/b.test.ts > 完全不同的用例 · TypeError: t.mutate is not a function", attempt: 1 }, updatedAt: 8_000 }),
  flow("to-1", { rollback: { kind: "timeout", summary: "命令超时被杀", attempt: 1 } }),
  flow("old-1", { rollback: { kind: "test-failed", summary: "FAIL test/a.test.ts > x · AssertionError: expected 0 to be 1", attempt: 1 }, updatedAt: 100 }),
  flow("ok-1", { status: "verified", rollback: { kind: "test-failed", summary: "残留字段", attempt: 1 } }),
  flow("legacy-1", {}),
];

describe("回滚理由聚类（作者锁定）", () => {
  it("按 kind×签名聚类：数字/路径差异归同簇；窗口外、非 rolled-back、无 rollback 的不算", () => {
    const clusters = collectRecurringRollbacks(FLOWS, { sinceMs: 5_000 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.kind).toBe("test-failed");
    expect(clusters[0]!.count).toBe(3);
    expect(clusters[0]!.flowIds).toEqual(["tf-1", "tf-2", "tf-3"]);
    expect(clusters[0]!.lastAt).toBe(9_500);
    expect(clusters[0]!.sample).toContain("AssertionError");
  });

  it("minCount=1 时全部簇入列，排序 count 降序再 lastAt 降序", () => {
    const clusters = collectRecurringRollbacks(FLOWS, { sinceMs: 5_000, minCount: 1 });
    expect(clusters.map((c) => [c.kind, c.count])).toEqual([["test-failed", 3], ["timeout", 1], ["test-failed", 1]]);
  });

  it("buildRecurrenceRules：每 kind 一条，同 kind 多簇合并计数、取最大簇样本、flowIds ≤5", () => {
    const clusters = collectRecurringRollbacks(FLOWS, { sinceMs: 5_000, minCount: 1 });
    const file = buildRecurrenceRules(clusters, { now: 10_000, sinceDays: 14 });
    expect(file.generatedAt).toBe(10_000);
    expect(file.sinceDays).toBe(14);
    expect(file.rules.map((r) => [r.code, r.count])).toEqual([["recurring-rollback:test-failed", 4], ["recurring-rollback:timeout", 1]]);
    const tf = file.rules[0]!;
    expect(tf.kind).toBe("test-failed");
    expect(tf.sample).toContain("AssertionError");
    expect(tf.hint).toBe(RECURRENCE_HINTS["test-failed"]);
    expect(tf.flowIds).toEqual(["tf-1", "tf-2", "tf-3", "tf-4"]);
  });

  it("提示表覆盖全部 RollbackKind 与 scope-gate/not-red-first；未知 kind 回落 unknown", () => {
    for (const kind of ["transform-error", "typecheck", "test-failed", "lint", "check-regression", "timeout", "empty-diff", "no-accept-cmd", "anchor-missing", "unknown", "scope-gate", "not-red-first"]) {
      expect(typeof RECURRENCE_HINTS[kind], kind).toBe("string");
      expect(RECURRENCE_HINTS[kind]!.length, kind).toBeGreaterThan(4);
      expect(RECURRENCE_HINTS[kind]!.length, kind).toBeLessThanOrEqual(60);
    }
    expect(hintFor("something-new")).toBe(RECURRENCE_HINTS.unknown);
  });
});

describe("规则文件读写（作者锁定）", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-recur-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("路径固定在 .kunpeng 根；缺文件/坏 JSON/坏形状都返回空且不抛", () => {
    expect(recurrenceRulesPath(join(dir, ".kunpeng"))).toBe(join(dir, ".kunpeng", "spec-lint-rules.json"));
    expect(loadRecurrenceRules(join(dir, ".kunpeng"))).toEqual([]);
    writeFileSync(recurrenceRulesPath(dir), "{not json", "utf8");
    expect(loadRecurrenceRules(dir)).toEqual([]);
    writeFileSync(recurrenceRulesPath(dir), JSON.stringify({ rules: "nope" }), "utf8");
    expect(loadRecurrenceRules(dir)).toEqual([]);
    writeFileSync(recurrenceRulesPath(dir), JSON.stringify({ rules: [{ code: "x" }, { code: "recurring-rollback:lint", kind: "lint", count: 3, sample: "s", hint: "h", flowIds: [] }] }), "utf8");
    expect(loadRecurrenceRules(dir).map((r) => r.code)).toEqual(["recurring-rollback:lint"]);
  });

  it("writeRecurrenceRules 端到端：写文件、可读回；无簇也写空规则文件", async () => {
    const kp = join(dir, ".kunpeng");
    const { path, file } = await writeRecurrenceRules(kp, FLOWS, { now: 10_000, sinceDays: 14 });
    expect(path).toBe(recurrenceRulesPath(kp));
    expect(existsSync(path)).toBe(true);
    expect(file.rules.map((r) => r.code)).toEqual(["recurring-rollback:test-failed"]);
    expect(JSON.parse(readFileSync(path, "utf8")).rules).toHaveLength(1);
    expect(loadRecurrenceRules(kp)[0]!.count).toBe(3);
    const empty = await writeRecurrenceRules(kp, [], { now: 11_000, sinceDays: 14 });
    expect(empty.file.rules).toEqual([]);
    expect(loadRecurrenceRules(kp)).toEqual([]);
  });
});