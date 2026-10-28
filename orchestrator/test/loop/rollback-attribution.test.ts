import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyAcceptOutput, writeAcceptLog, acceptLogDir, ROLLBACK_SUMMARY_MAX } from "../../src/loop/rollback-attribution.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";

// 以下片段均为 2026-09 真实回滚里 accept 的原始输出(节选),不是编的。
const TRANSFORM = `
 FAIL  test/server/pricing-rate-card.test.ts [ test/server/pricing-rate-card.test.ts ]
Error: Transform failed with 2 errors:
/Users/x/kunpeng/.kunpeng/wt/f1/orchestrator/src/server/chat-usage.ts:42:18: ERROR: Unterminated string literal
  [PARSE_ERROR] Unterminated string literal
 Test Files  1 failed (1)
      Tests  no tests
`;
const VITEST = `
 RUN  v4.1.10 /Users/x/kunpeng/.kunpeng/wt/f2/orchestrator
 ✓ test/server/a.test.ts (3 tests) 12ms
 FAIL  test/server/pricing-rate-card.test.ts > 计费卡 > gpt-5.5 四向价
AssertionError: expected 12 to be 17.5
 ❯ test/server/pricing-rate-card.test.ts:31:29
 Test Files  1 failed | 3 passed (4)
      Tests  1 failed | 41 passed (42)
`;
const TSC = `
src/server/chat-usage.ts(88,7): error TS2322: Type 'string' is not assignable to type 'number'.
src/server/chat-usage.ts(91,3): error TS2554: Expected 2 arguments, but got 1.
`;
const ESLINT = `
/Users/x/kunpeng/orchestrator/src/loop/foo.ts
  12:5  error  'unused' is assigned a value but never used  @typescript-eslint/no-unused-vars

✖ 1 problem (1 error, 0 warnings)
`;
const ANCHOR = `验证失败，命令自身输出为空。以下是执行到的最后几条子命令(trace)，其后是 accept 重定向到文件的真实输出：
+ cd orchestrator
+ grep -q 'args: \\["exec", "--json",' src/server/chat-stream.ts`;
const TIMEOUT = `验证失败：命令超时被杀(>timeout)、无输出。以下为执行到的最后几条子命令(trace)：
+ npx vitest run test/x.test.ts`;
const REGRESSION = `项目检查 [npm run lint] 引入基线之外的新问题:
  7:1  error  Parsing error: Unexpected token  `;

describe("classifyAcceptOutput:确定性归因(作者锁定)", () => {
  test("Transform failed / [PARSE_ERROR] → transform-error,summary 取 PARSE_ERROR 行(优先于 vitest 的 Test Files 1 failed)", () => {
    const r = classifyAcceptOutput(TRANSFORM);
    expect(r.kind).toBe("transform-error");
    expect(r.summary).toBe("[PARSE_ERROR] Unterminated string literal");
  });
  test("vitest 真失败 → test-failed,summary = FAIL 行 · AssertionError 行", () => {
    const r = classifyAcceptOutput(VITEST);
    expect(r.kind).toBe("test-failed");
    expect(r.summary).toBe("FAIL test/server/pricing-rate-card.test.ts > 计费卡 > gpt-5.5 四向价 · AssertionError: expected 12 to be 17.5");
  });
  test("只有 AssertionError 没有 FAIL 行也归 test-failed", () => {
    expect(classifyAcceptOutput("AssertionError: expected 12 to be 17.5\n").kind).toBe("test-failed");
  });
  test("error TS → typecheck,summary 是第一条 TS 错", () => {
    const r = classifyAcceptOutput(TSC);
    expect(r.kind).toBe("typecheck");
    expect(r.summary).toContain("error TS2322");
    expect(r.summary).not.toContain("TS2554");
  });
  test("eslint 报错 → lint", () => {
    const r = classifyAcceptOutput(ESLINT);
    expect(r.kind).toBe("lint");
    expect(r.summary).toContain("no-unused-vars");
  });
  test("grep 锚点失败(bash -x trace、无 vitest 标记) → anchor-missing,summary 是最后一条 trace", () => {
    const r = classifyAcceptOutput(ANCHOR);
    expect(r.kind).toBe("anchor-missing");
    expect(r.summary).toContain("+ grep -q");
  });
  test("空输出 → anchor-missing;超时 → timeout;差分门回归 → check-regression;无验收命令 → no-accept-cmd", () => {
    expect(classifyAcceptOutput("").kind).toBe("anchor-missing");
    expect(classifyAcceptOutput("   \n\n").kind).toBe("anchor-missing");
    expect(classifyAcceptOutput(TIMEOUT).kind).toBe("timeout");
    expect(classifyAcceptOutput(REGRESSION).kind).toBe("check-regression");
    expect(classifyAcceptOutput("spec 未给出验收验证命令，无法判定完成（fails closed）").kind).toBe("no-accept-cmd");
    expect(classifyAcceptOutput("[accept] empty-diff: 相对 main 无任何改动").kind).toBe("empty-diff");
  });
  test("ANSI 色码不影响归因;长输出且无特征 → unknown;summary ≤ 200", () => {
    expect(classifyAcceptOutput("\u001b[31m FAIL \u001b[39m test/a.test.ts > x\n\u001b[31mAssertionError: boom\u001b[39m").kind).toBe("test-failed");
    const long = `${"x".repeat(700)}\nsomething broke: ${"y".repeat(400)}\n`;
    const r = classifyAcceptOutput(long);
    expect(r.kind).toBe("unknown");
    expect(r.summary.length).toBeLessThanOrEqual(ROLLBACK_SUMMARY_MAX);
  });
  test("同一输入永远同一输出(确定性)", () => {
    expect(classifyAcceptOutput(VITEST)).toEqual(classifyAcceptOutput(VITEST));
  });
});

describe("writeAcceptLog + FlowTracker.setRollback(作者锁定)", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-accept-log-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("落盘到 <kunpengDir>/accept-logs/<flowId>/<N>.txt,编号 append-only 不覆盖", async () => {
    const a = await writeAcceptLog(dir, "flow-a", { cmd: "npx vitest run t.test.ts", exitCode: 1, passed: false, output: VITEST });
    const b = await writeAcceptLog(dir, "flow-a", { cmd: "npx vitest run t.test.ts", exitCode: 1, passed: false, output: "", extra: ANCHOR });
    expect(a).toEqual({ path: join(acceptLogDir(dir, "flow-a"), "1.txt"), attempt: 1 });
    expect(b).toEqual({ path: join(acceptLogDir(dir, "flow-a"), "2.txt"), attempt: 2 });
    expect((await readdir(acceptLogDir(dir, "flow-a"))).sort()).toEqual(["1.txt", "2.txt"]);
    const one = await readFile(a!.path, "utf8");
    expect(one).toContain("# cmd: npx vitest run t.test.ts");
    expect(one).toContain("# exit=1 passed=false");
    expect(one).toContain("AssertionError: expected 12 to be 17.5");
    const two = await readFile(b!.path, "utf8");
    expect(two).toContain("── 补充诊断(dev-cycle) ──");
    expect(two).toContain("+ grep -q");
  });

  test("setRollback 落进 FlowState.rollback,finish(rolled-back) 不抹掉", async () => {
    const t = new FlowTracker(join(dir, "state"), () => 1000);
    await t.start("f1", "需求");
    await t.setRollback("f1", { kind: "test-failed", summary: "FAIL x · AssertionError: y", acceptLogPath: "/p/.kunpeng/accept-logs/f1/2.txt", attempt: 2 });
    await t.finish("f1", "rolled-back", undefined, "原因");
    const s = await t.read("f1");
    expect(s?.status).toBe("rolled-back");
    expect(s?.rollback).toEqual({ kind: "test-failed", summary: "FAIL x · AssertionError: y", acceptLogPath: "/p/.kunpeng/accept-logs/f1/2.txt", attempt: 2 });
    expect(s?.failureReason).toBe("原因");
  });
});