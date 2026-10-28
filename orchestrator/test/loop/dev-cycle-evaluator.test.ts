import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../../src/artifacts/store.js";
import type { AgentRequest, AgentResult, AgentRunner } from "../../src/agent/runner.js";
import { Workspace } from "../../src/git/workspace.js";
import { DevCycle } from "../../src/loop/dev-cycle.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { createLogger } from "../../src/runtime/logger.js";

const acceptanceCmd = 'node -e "process.exit(0)"';

class EvalRunner implements AgentRunner {
  readonly verifyRequests: AgentRequest[] = [];
  constructor(private readonly verifyText: string, private readonly verifyBackend = "claude") {}
  async run(req: AgentRequest): Promise<AgentResult> {
    if (req.stage === "spec") return { text: "## acceptance\n- result.txt 含 ok", meta: { testCmd: acceptanceCmd }, backend: "claude" };
    if (req.stage === "implement") {
      writeFileSync(join(req.cwd!, "result.txt"), "ok\n");
      return { text: "done", meta: {}, backend: "codex" };
    }
    if (req.stage === "verify") {
      this.verifyRequests.push(req);
      return { text: this.verifyText, meta: { tokens: 12 }, backend: this.verifyBackend };
    }
    throw new Error(`unexpected stage: ${req.stage}`);
  }
}

let repo: string;
let store: ArtifactStore;
let ws: Workspace;
let tracker: FlowTracker;
let savedEnv: string | undefined;

beforeEach(async () => {
  savedEnv = process.env.KUNPENG_VERIFY_EVALUATOR;
  delete process.env.KUNPENG_VERIFY_EVALUATOR;
  repo = mkdtempSync(join(tmpdir(), "kp-dc-evaluator-"));
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
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.KUNPENG_VERIFY_EVALUATOR; else process.env.KUNPENG_VERIFY_EVALUATOR = savedEnv;
  rmSync(repo, { recursive: true, force: true });
});

test("评估器 pass：只读调用（tools 空、避开实现者后端、看得到 diff 与验收输出），判定与后端落 spec meta 与 FlowState", async () => {
  const runner = new EvalRunner('{"verdict":"pass","reason":"diff 只加了 result.txt，验收全绿"}');
  const dc = new DevCycle({ store, ws, runner, tracker, flowId: "ev-pass", verifyEvaluator: true });

  const result = await dc.run("写 result.txt");

  expect(result.status).toBe("verified");
  expect(runner.verifyRequests).toHaveLength(1);
  const req = runner.verifyRequests[0]!;
  expect(req.tools).toEqual([]);
  expect(req.avoidBackend).toBe("codex");
  expect(req.system).toContain("只读");
  expect(req.system).not.toContain("你就是本 flow 的实现者");
  expect(req.input).toContain("+ok");
  expect(req.input).toContain("# 验收命令输出");
  const spec = await store.read("ev-pass");
  expect(spec.status).toBe("verified");
  expect(spec.meta.verifyVerdict).toBe("pass");
  expect(spec.meta.verifyBackend).toBe("claude");
  expect(spec.meta.verifyReason).toBe("diff 只加了 result.txt，验收全绿");
  const state = await tracker.read("ev-pass");
  expect(state?.stageBackends?.verify).toBe("claude");
  expect(state?.stageBackends?.implement).toBe("codex");
  expect(state?.status).toBe("verified");
});

test("评估器 fail：验收虽绿也不算 verified，回滚归因 kind=verify-evaluator，判定落盘", async () => {
  const runner = new EvalRunner('{"verdict":"fail","reason":"spec 要求同时改文档，diff 没有"}');
  const dc = new DevCycle({ store, ws, runner, tracker, flowId: "ev-fail", verifyEvaluator: true });

  const result = await dc.run("写 result.txt");

  expect(result.status).toBe("rolled-back");
  expect(result.evidence).toBe("[verify] 评估器判定 fail：spec 要求同时改文档，diff 没有");
  const spec = await store.read("ev-fail");
  expect(spec.status).toBe("rolled-back");
  expect(spec.meta.verifyVerdict).toBe("fail");
  const state = await tracker.read("ev-fail");
  expect(state?.status).toBe("rolled-back");
  expect(state?.rollback?.kind).toBe("verify-evaluator");
  expect(state?.rollback?.summary).toContain("评估器判定 fail");
  const exp = (await store.list("experience")).find((a) => a.meta.sourceFlow === "ev-fail");
  expect(exp?.meta.outcome).toBe("rolled-back");
  expect(exp?.meta.verifyVerdict).toBe("fail");
});

test("评估器输出不可解析 → inconclusive，挂人工门不回滚（D8c）", async () => {
  const runner = new EvalRunner("我觉得大概没问题吧");
  const dc = new DevCycle({ store, ws, runner, tracker, flowId: "ev-inconclusive", verifyEvaluator: true });

  const result = await dc.run("写 result.txt");

  expect(result.status).toBe("verified");
  expect((await tracker.read("ev-inconclusive"))?.humanGate?.gate).toContain("评估器无法判定");
  expect((await store.read("ev-inconclusive")).meta.verifyVerdict).toBe("inconclusive");
});

test("缺省关闭：不调 verify 阶段、meta 无判定；KUNPENG_VERIFY_EVALUATOR=1 时打开", async () => {
  const off = new EvalRunner('{"verdict":"fail","reason":"不该被调用"}');
  const r1 = await new DevCycle({ store, ws, runner: off, tracker, flowId: "ev-off" }).run("写 result.txt");
  expect(r1.status).toBe("verified");
  expect(off.verifyRequests).toHaveLength(0);
  expect((await store.read("ev-off")).meta.verifyVerdict).toBeUndefined();

  process.env.KUNPENG_VERIFY_EVALUATOR = "1";
  const on = new EvalRunner('{"verdict":"pass","reason":"ok"}');
  const r2 = await new DevCycle({ store, ws, runner: on, tracker, flowId: "ev-env" }).run("写 result.txt");
  expect(r2.status).toBe("verified");
  expect(on.verifyRequests).toHaveLength(1);
  expect((await store.read("ev-env")).meta.verifyVerdict).toBe("pass");
});

test("评估器与实现者同后端时记一行日志，判定仍照常落盘", async () => {
  const lines: string[] = [];
  const logger = createLogger({ sink: (line) => lines.push(line), minLevel: "warn" });
  const runner = new EvalRunner('{"verdict":"pass","reason":"ok"}', "codex");
  const dc = new DevCycle({ store, ws, runner, tracker, logger, flowId: "ev-same", verifyEvaluator: true });

  const result = await dc.run("写 result.txt");

  expect(result.status).toBe("verified");
  expect(lines.some((l) => l.includes("[verify] 仅一个后端可用，评估器与实现者同后端"))).toBe(true);
  expect((await store.read("ev-same")).meta.verifyBackend).toBe("codex");
});