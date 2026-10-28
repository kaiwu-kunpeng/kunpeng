import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { Workspace } from "../../src/git/workspace.js";
import { FakeRunner } from "../../src/agent/runner.js";
import { DevCycle } from "../../src/loop/dev-cycle.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { createLogger } from "../../src/runtime/logger.js";

// accept 命令:向 stderr 吐一段真实 vitest 失败输出后 exit 1(片段来自 2026-09 真实回滚)。
const VITEST_FAIL = [
  " FAIL  test/server/pricing-rate-card.test.ts > 计费卡 > gpt-5.5 四向价",
  "AssertionError: expected 12 to be 17.5",
  " Test Files  1 failed | 3 passed (4)",
  "      Tests  1 failed | 41 passed (42)",
].join("\n");
const failingAccept = `node -e ${JSON.stringify(`process.stderr.write(${JSON.stringify(VITEST_FAIL)} + "\\n"); process.exit(1);`)}`;

let repo: string;
let store: ArtifactStore;
let ws: Workspace;
let tracker: FlowTracker;
let lines: string[];

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-rb-attr-"));
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  writeFileSync(join(repo, "README.md"), "base\n");
  await g.add(".");
  await g.commit("init");
  store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
  ws = new Workspace(repo);
  tracker = new FlowTracker(join(repo, ".kunpeng", "state"));
  lines = [];
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("回滚带归因:FlowState.rollback{kind,summary,acceptLogPath,attempt} + 每次 accept 完整落盘 + 日志行 kind=/summary=/log=", async () => {
  const runner = new FakeRunner({ implement: { text: "done", meta: {} } });
  const logger = createLogger({ sink: (l) => lines.push(l), minLevel: "warn" });
  const dc = new DevCycle({
    store, ws, runner, tracker, logger, flowId: "rb-attr-1",
    precomputedSpec: { text: "SPEC", meta: {} },
    acceptanceCmd: failingAccept,
    maxRepairAttempts: 1,
  });

  const result = await dc.run("make it pass");
  expect(result.status).toBe("rolled-back");

  // 1) accept 日志:两次 accept(首验 + 1 次 repair 后复验)→ 1.txt、2.txt,内容是完整 stdout+stderr。
  const logDir = join(repo, ".kunpeng", "accept-logs", "rb-attr-1");
  expect((await readdir(logDir)).sort()).toEqual(["1.txt", "2.txt"]);
  const second = await readFile(join(logDir, "2.txt"), "utf8");
  expect(second).toContain("# exit=1 passed=false");
  expect(second).toContain("AssertionError: expected 12 to be 17.5");
  expect(second).toContain("Tests  1 failed | 41 passed (42)");

  // 2) FlowState.rollback 归因。
  const state = await tracker.read("rb-attr-1");
  expect(state?.status).toBe("rolled-back");
  expect(state?.rollback).toEqual({
    kind: "test-failed",
    summary: "FAIL test/server/pricing-rate-card.test.ts > 计费卡 > gpt-5.5 四向价 · AssertionError: expected 12 to be 17.5",
    acceptLogPath: join(logDir, "2.txt"),
    attempt: 2,
  });
  // 既有 failureReason 兜底链不受影响。
  expect(state?.failureReason).toContain("AssertionError: expected 12 to be 17.5");

  // 3) 日志行:kind=/summary=/log= 取代原来的 reason=<末 160 字符>。
  const line = lines.find((l) => l.includes("flow rolled-back (verification failed)"));
  expect(line).toBeDefined();
  expect(line).toContain("kind=test-failed");
  expect(line).toContain("summary=FAIL test/server/pricing-rate-card.test.ts");
  expect(line).toContain(`log=${join(logDir, "2.txt")}`);
  expect(line).not.toContain("reason=");
});

test("验证通过也落盘 accept 日志(passed=true),且不写 rollback", async () => {
  const runner = new FakeRunner({ implement: { text: "done", meta: {} } });
  const dc = new DevCycle({
    store, ws, runner, tracker, flowId: "rb-attr-ok",
    precomputedSpec: { text: "SPEC", meta: {} },
    acceptanceCmd: "node -e \"console.log('all good'); process.exit(0)\"",
  });
  const result = await dc.run("ok");
  expect(result.status).toBe("verified");
  const logDir = join(repo, ".kunpeng", "accept-logs", "rb-attr-ok");
  expect(await readdir(logDir)).toEqual(["1.txt"]);
  const one = await readFile(join(logDir, "1.txt"), "utf8");
  expect(one).toContain("# exit=0 passed=true");
  expect(one).toContain("all good");
  expect((await tracker.read("rb-attr-ok"))?.rollback).toBeUndefined();
});