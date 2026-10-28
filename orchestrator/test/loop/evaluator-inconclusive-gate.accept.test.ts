import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../../src/artifacts/store.js";
import type { AgentRequest, AgentResult, AgentRunner } from "../../src/agent/runner.js";
import { Workspace } from "../../src/git/workspace.js";
import { runAutopilot } from "../../src/loop/autopilot.js";
import { DevCycle } from "../../src/loop/dev-cycle.js";
import { classifyFailureText } from "../../src/loop/rollback-attribution.js";
import { readFlowOptions, resolveVerifyEvaluator } from "../../src/runtime/flow-options.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";

const acceptanceCmd = 'node -e "process.exit(0)"';

class EvalRunner implements AgentRunner {
  readonly verifyRequests: AgentRequest[] = [];
  constructor(private readonly verifyText: string) {}
  async run(req: AgentRequest): Promise<AgentResult> {
    if (req.stage === "spec") return { text: "## acceptance\n- result.txt 含 ok", meta: { testCmd: acceptanceCmd }, backend: "claude" };
    if (req.stage === "implement") {
      writeFileSync(join(req.cwd!, "result.txt"), "ok\n");
      return { text: "done", meta: {}, backend: "codex" };
    }
    if (req.stage === "verify") {
      this.verifyRequests.push(req);
      return { text: this.verifyText, meta: { tokens: 12 }, backend: "claude" };
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
  repo = mkdtempSync(join(tmpdir(), "kp-eval-gate-"));
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

function writeFlowOptions(raw: string): void {
  mkdirSync(join(repo, ".kunpeng"), { recursive: true });
  writeFileSync(join(repo, ".kunpeng", "flow-options.json"), raw);
}

describe("评估器判不定 → 人工门，不做终审（D8c，作者锁定）", () => {
  test("独立流 inconclusive：verified 并挂「评估器无法判定」门，门名不含合并主干", async () => {
    const runner = new EvalRunner("我觉得大概没问题吧");
    const result = await new DevCycle({ store, ws, runner, tracker, flowId: "ev-gate", verifyEvaluator: true }).run("写 result.txt");
    expect(result.status).toBe("verified");
    const state = await tracker.read("ev-gate");
    expect(state?.status).toBe("verified");
    expect(state?.humanGate?.gate).toContain("评估器无法判定");
    expect(state?.humanGate?.gate).not.toContain("合并主干");
    expect(state?.humanGate?.what).toBe("kp/ev-gate → main");
    const spec = await store.read("ev-gate");
    expect(spec.status).toBe("verified");
    expect(spec.meta.verifyVerdict).toBe("inconclusive");
  });

  test("autopilot 不会自动合并评估器门（候选只认合并主干门）", async () => {
    await new DevCycle({ store, ws, runner: new EvalRunner("说不清"), tracker, flowId: "ev-auto", verifyEvaluator: true }).run("写 result.txt");
    const merges: string[] = [];
    const out = await runAutopilot({
      tracker,
      merge: async (flowId) => { merges.push(flowId); return { ok: true }; },
      log: () => {},
    });
    expect(merges).toEqual([]);
    expect(out.merged).not.toContain("ev-auto");
  });

  test("reason 里出现「合并主干」也会被改写，门名依旧不含它", async () => {
    const runner = new EvalRunner('{"verdict":"inconclusive","reason":"diff 被截断，建议人工合并主干前再看"}');
    await new DevCycle({ store, ws, runner, tracker, flowId: "ev-sanitize", verifyEvaluator: true }).run("写 result.txt");
    const gate = (await tracker.read("ev-sanitize"))?.humanGate?.gate ?? "";
    expect(gate).toContain("评估器无法判定");
    expect(gate).toContain("diff 被截断");
    expect(gate).not.toContain("合并主干");
  });

  test("fail 照旧回滚，归因 verify-evaluator", async () => {
    const result = await new DevCycle({ store, ws, runner: new EvalRunner('{"verdict":"fail","reason":"没改文档"}'), tracker, flowId: "ev-fail2", verifyEvaluator: true }).run("写 result.txt");
    expect(result.status).toBe("rolled-back");
    expect((await tracker.read("ev-fail2"))?.rollback?.kind).toBe("verify-evaluator");
  });
});

describe("按项目开关 .kunpeng/flow-options.json（作者锁定）", () => {
  test("项目配置开、环境变量未设 → 评估器被调用", async () => {
    writeFlowOptions(JSON.stringify({ verifyEvaluator: true }));
    const runner = new EvalRunner('{"verdict":"pass","reason":"ok"}');
    await new DevCycle({ store, ws, runner, tracker, flowId: "ev-proj-on" }).run("写 result.txt");
    expect(runner.verifyRequests).toHaveLength(1);
  });

  test("项目配置开、环境变量 0 → 不调用（环境变量优先）", async () => {
    writeFlowOptions(JSON.stringify({ verifyEvaluator: true }));
    process.env.KUNPENG_VERIFY_EVALUATOR = "0";
    const runner = new EvalRunner('{"verdict":"pass","reason":"ok"}');
    await new DevCycle({ store, ws, runner, tracker, flowId: "ev-env-off" }).run("写 result.txt");
    expect(runner.verifyRequests).toHaveLength(0);
  });

  test("配置写坏 → 按更严格处理，评估器被调用", async () => {
    writeFlowOptions("{ 坏 json");
    const runner = new EvalRunner('{"verdict":"pass","reason":"ok"}');
    await new DevCycle({ store, ws, runner, tracker, flowId: "ev-bad-cfg" }).run("写 result.txt");
    expect(runner.verifyRequests).toHaveLength(1);
  });

  test("没有配置文件、环境变量未设 → 不调用（客户项目默认关）", async () => {
    const runner = new EvalRunner('{"verdict":"pass","reason":"ok"}');
    await new DevCycle({ store, ws, runner, tracker, flowId: "ev-none" }).run("写 result.txt");
    expect(runner.verifyRequests).toHaveLength(0);
  });

  test("纯函数：优先级与读配置", () => {
    expect(resolveVerifyEvaluator(false, "1", { verifyEvaluator: true })).toBe(false);
    expect(resolveVerifyEvaluator(undefined, "1", {})).toBe(true);
    expect(resolveVerifyEvaluator(undefined, "0", { verifyEvaluator: true })).toBe(false);
    expect(resolveVerifyEvaluator(undefined, undefined, { verifyEvaluator: true })).toBe(true);
    expect(resolveVerifyEvaluator(undefined, undefined, {})).toBe(false);
    expect(readFlowOptions(repo)).toEqual({ options: {} });
    writeFlowOptions(JSON.stringify({ verifyEvaluator: "yes" }));
    const bad = readFlowOptions(repo);
    expect(bad.options.verifyEvaluator).toBe(true);
    expect(bad.error).toContain("verifyEvaluator");
  });
});

describe("回滚归因补 verify-evaluator（作者锁定）", () => {
  test("评估器失败文本归到 verify-evaluator，不再落 unknown", () => {
    expect(classifyFailureText("[verify] 评估器判定 fail：没改文档").kind).toBe("verify-evaluator");
    expect(classifyFailureText("评估器无法判定·人工确认 (人工门#1)：x 被人工驳回").kind).toBe("verify-evaluator");
  });
});