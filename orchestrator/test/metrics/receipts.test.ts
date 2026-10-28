import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowTracker, type FlowState } from "../../src/runtime/flowstate.js";
import { backfillReceipts, claudeProjectDirName, findSessionUsage, isReceiptCovered, receiptCoverage, renderReceiptReport } from "../../src/metrics/receipts.js";

let dir: string;
let repoRoot: string;
let codexHome: string;
let claudeDir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-receipts-"));
  repoRoot = join(dir, "repo");
  codexHome = join(dir, "codex");
  claudeDir = join(dir, "claude");
  mkdirSync(repoRoot, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// 夹具取自真实 rollout 文件形态（2026-09-16 ~/.codex/sessions）：session_meta 首行 + 累计 token_count。
function writeCodexSession(flowId: string, sessionId: string, usages: { input: number; cached: number; write: number; output: number }[]): void {
  const d = join(codexHome, "sessions", "2026", "09", "16");
  mkdirSync(d, { recursive: true });
  const lines = [
    JSON.stringify({ timestamp: "2026-09-16T15:13:42.496Z", ordinal: 0, type: "session_meta", payload: { session_id: sessionId, id: sessionId, cwd: join(repoRoot, ".kunpeng", "wt", flowId), originator: "codex_exec", cli_version: "0.154.0" } }),
    ...usages.map((u, i) => JSON.stringify({ timestamp: "t", ordinal: i + 1, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: u.input, cached_input_tokens: u.cached, cache_write_input_tokens: u.write, output_tokens: u.output, reasoning_output_tokens: 0, total_tokens: u.input + u.output }, last_token_usage: {} } } })),
  ];
  writeFileSync(join(d, `rollout-2026-09-16T15-13-42-${sessionId}.jsonl`), lines.join("\n") + "\n", "utf8");
}
function writeClaudeTranscript(flowId: string, usages: { input: number; output: number; create: number; read: number }[]): void {
  const d = join(claudeDir, "projects", claudeProjectDirName(join(repoRoot, ".kunpeng", "wt", flowId)));
  mkdirSync(d, { recursive: true });
  const lines = [
    JSON.stringify({ type: "user", message: { role: "user", content: "hi" }, sessionId: "c-1" }),
    ...usages.map((u) => JSON.stringify({ type: "assistant", sessionId: "c-1", message: { role: "assistant", usage: { input_tokens: u.input, output_tokens: u.output, cache_creation_input_tokens: u.create, cache_read_input_tokens: u.read } } })),
  ];
  writeFileSync(join(d, "c-1.jsonl"), lines.join("\n") + "\n", "utf8");
}
function flow(id: string, patch: Partial<FlowState>): FlowState {
  return { flowId: id, requirement: id, stage: "done", status: "verified", agentActive: false, pid: 1, host: "h", startedAt: 1, updatedAt: 2, history: [], ...patch } as FlowState;
}

describe("收据覆盖率（作者锁定）", () => {
  it("分母剔除 plan-/igate- 聚合流；tokensUsed 或四象限任一即算覆盖", () => {
    expect(isReceiptCovered({ tokensUsed: 5 })).toBe(true);
    expect(isReceiptCovered({ tokenQuad: { input: 1, output: 0, cacheCreate: 0, cacheRead: 0 } })).toBe(true);
    expect(isReceiptCovered({ tokensUsed: 0, tokenQuad: { input: 0, output: 0, cacheCreate: 9, cacheRead: 9 } })).toBe(false);
    const cov = receiptCoverage([
      flow("a", { tokensUsed: 100 }),
      flow("b", { status: "rolled-back" }),
      flow("plan-x", {}),
      flow("igate-int-y", {}),
      flow("c", { status: "running" }),
      flow("d", { tokenQuad: { input: 3, output: 4, cacheCreate: 0, cacheRead: 0 } }),
    ]);
    expect(cov).toEqual({ total: 3, covered: 2, missing: ["b"], aggregates: 2, pct: 66.7 });
    const text = renderReceiptReport(cov);
    expect(text).toContain("收据覆盖率 66.7%");
    expect(text).toContain("2/3");
    expect(text).toContain("聚合流 2 条不计分母");
    expect(text).toContain("b");
  });

  it("claude 项目目录名：非字母数字全部换成 -", () => {
    expect(claudeProjectDirName("/Users/x/kunpeng/.kunpeng/wt/f1")).toBe("-Users-x-kunpeng--kunpeng-wt-f1");
  });
});

describe("从会话记录回填（作者锁定）", () => {
  it("codex：按 cwd 匹配 rollout 文件，取最后一条累计用量，多会话求和；claude：按项目目录累加 assistant usage", () => {
    writeCodexSession("f1", "s-a", [{ input: 100, cached: 20, write: 0, output: 10 }, { input: 46945, cached: 12928, write: 5, output: 160 }]);
    writeCodexSession("f1", "s-b", [{ input: 1000, cached: 0, write: 0, output: 50 }]);
    const u = findSessionUsage({ flowId: "f1" }, { repoRoot, codexHome, claudeDir })!;
    expect(u.backend).toBe("codex");
    expect(u.source).toBe("codex-session");
    expect(u.input).toBe(46945 - 12928 + 1000);
    expect(u.output).toBe(210);
    expect(u.cacheRead).toBe(12928);
    expect(u.cacheCreate).toBe(5);

    writeClaudeTranscript("f2", [{ input: 10, output: 20, create: 30, read: 40 }, { input: 1, output: 2, create: 3, read: 4 }]);
    const c = findSessionUsage({ flowId: "f2" }, { repoRoot, codexHome, claudeDir })!;
    expect(c).toMatchObject({ backend: "claude", source: "claude-transcript", input: 11, output: 22, cacheCreate: 33, cacheRead: 44 });

    expect(findSessionUsage({ flowId: "nope" }, { repoRoot, codexHome, claudeDir })).toBeNull();
  });

  it("codex 也可按 stageSessions 的 sessionId 匹配（cwd 不同也行）", () => {
    writeCodexSession("elsewhere", "s-z", [{ input: 500, cached: 100, write: 0, output: 7 }]);
    const u = findSessionUsage({ flowId: "f3", stageSessions: { implement: { backend: "codex", sessionId: "s-z", at: 1 } } }, { repoRoot, codexHome, claudeDir })!;
    expect(u.input).toBe(400);
    expect(u.output).toBe(7);
  });

  it("backfillReceipts：dry-run 只列；真跑写四象限与 tokensUsed、标 receiptSource=backfill；找不到的记 notFound", async () => {
    const t = new FlowTracker(join(repoRoot, ".kunpeng", "state"), () => 1_700_000_000_000);
    await t.start("has", "a"); await t.addTokens("has", 50); await t.finish("has", "verified");
    await t.start("missing-codex", "b"); await t.finish("missing-codex", "rolled-back", undefined, "x");
    await t.start("missing-none", "c"); await t.finish("missing-none", "verified");
    await t.start("plan-p", "d"); await t.finish("plan-p", "verified");
    writeCodexSession("missing-codex", "s-m", [{ input: 300, cached: 100, write: 2, output: 30 }]);

    const dry = await backfillReceipts(t, { repoRoot, codexHome, claudeDir, dryRun: true });
    expect(dry.scanned).toBe(2);
    expect(dry.filled).toBe(0);
    expect(dry.notFound).toEqual(["missing-none"]);
    expect(dry.entries).toEqual([{ flowId: "missing-codex", source: "codex-session", input: 200, output: 30 }]);
    expect((await t.read("missing-codex"))!.tokensUsed).toBeUndefined();

    const real = await backfillReceipts(t, { repoRoot, codexHome, claudeDir });
    expect(real.filled).toBe(1);
    const s = (await t.read("missing-codex"))!;
    expect(s.tokenQuad).toEqual({ input: 200, output: 30, cacheCreate: 2, cacheRead: 100 });
    expect(s.tokensUsed).toBe(230);
    expect(s.receiptSource).toBe("backfill");
    expect((await t.read("has"))!.receiptSource).toBeUndefined();
    expect((await t.read("plan-p"))!.tokensUsed).toBeUndefined();
    expect(JSON.parse(readFileSync(join(repoRoot, ".kunpeng", "state", "missing-codex.json"), "utf8")).receiptSource).toBe("backfill");
    expect(receiptCoverage(await t.list())).toMatchObject({ total: 3, covered: 2, missing: ["missing-none"], aggregates: 1 });
  });
});