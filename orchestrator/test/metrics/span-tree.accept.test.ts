import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../../src/artifacts/store.js";
import type { AgentRequest, AgentResult, AgentRunner } from "../../src/agent/runner.js";
import { Workspace } from "../../src/git/workspace.js";
import { DevCycle } from "../../src/loop/dev-cycle.js";
import { createFlowSpans, readSpans, ROOT_SPAN_NAME, spanLogPath, traceIdForFlow } from "../../src/metrics/span-log.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";

const PASS = 'node -e "process.exit(0)"';
const FAIL = 'node -e "process.exit(1)"';

class Runner implements AgentRunner {
  constructor(private readonly testCmd: string, private readonly boomAt?: string) {}
  async run(req: AgentRequest): Promise<AgentResult> {
    if (req.stage === this.boomAt) throw new Error("后端炸了");
    if (req.stage === "spec") return { text: "## acceptance\n- ok", meta: { testCmd: this.testCmd, tokens: 7 }, backend: "claude", modelUsed: "claude-opus-5" };
    if (req.stage === "implement") {
      writeFileSync(join(req.cwd!, "result.txt"), "ok\n");
      return { text: "done", meta: { tokens: 11 }, backend: "codex", modelUsed: "gpt-6-astra" };
    }
    throw new Error(`unexpected stage: ${req.stage}`);
  }
}

let repo: string;
let store: ArtifactStore;
let ws: Workspace;
let tracker: FlowTracker;
let savedEval: string | undefined;

beforeEach(async () => {
  savedEval = process.env.KUNPENG_VERIFY_EVALUATOR;
  process.env.KUNPENG_VERIFY_EVALUATOR = "0";
  repo = mkdtempSync(join(tmpdir(), "kp-span-"));
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
  if (savedEval === undefined) delete process.env.KUNPENG_VERIFY_EVALUATOR; else process.env.KUNPENG_VERIFY_EVALUATOR = savedEval;
  rmSync(repo, { recursive: true, force: true });
});

const spansOf = (flowId: string) => readSpans(spanLogPath(join(repo, ".kunpeng"), flowId));

describe("span 模块（作者锁定）", () => {
  test("同一 flowId 恒得同一 32 位 traceId；子 span 挂在根下；坏行跳过", async () => {
    expect(traceIdForFlow("f1")).toMatch(/^[0-9a-f]{32}$/);
    expect(traceIdForFlow("f1")).toBe(traceIdForFlow("f1"));
    expect(traceIdForFlow("f1")).not.toBe(traceIdForFlow("f2"));
    let clock = 1000;
    const spans = createFlowSpans(join(repo, ".kunpeng"), "unit", () => clock);
    clock = 1500;
    expect(await spans.child("chat spec", 1100, "ok", { "kunpeng.stage": "spec" })).toBe(true);
    clock = 2000;
    expect(await spans.finishRoot("ok", {})).toBe(true);
    writeFileSync(spanLogPath(join(repo, ".kunpeng"), "unit"), "{坏行\n", { flag: "a" });
    const read = await spansOf("unit");
    expect(read).toHaveLength(2);
    const root = read.find((s) => s.name === ROOT_SPAN_NAME)!;
    const child = read.find((s) => s.name === "chat spec")!;
    expect(root.parentSpanId).toBeUndefined();
    expect(root.spanId).toBe(spans.rootSpanId);
    expect([root.startMs, root.endMs]).toEqual([1000, 2000]);
    expect(child.parentSpanId).toBe(root.spanId);
    expect(child.traceId).toBe(root.traceId);
    expect([child.startMs, child.endMs]).toEqual([1100, 1500]);
  });
});

describe("开发循环落 span 树（作者锁定）", () => {
  test("verified 流：根 span ok，spec/implement 两个 chat 子 span 挂在根下，带后端/模型/token", async () => {
    const result = await new DevCycle({ store, ws, runner: new Runner(PASS), tracker, flowId: "sp-ok" }).run("写 result.txt");
    expect(result.status).toBe("verified");
    const spans = await spansOf("sp-ok");
    const root = spans.find((s) => s.name === ROOT_SPAN_NAME)!;
    expect(root).toBeDefined();
    expect(root.status).toBe("ok");
    expect(root.traceId).toBe(traceIdForFlow("sp-ok"));
    expect(root.attributes["kunpeng.flow.status"]).toBe("verified");
    expect(root.attributes["gen_ai.operation.name"]).toBe("invoke_agent");
    const children = spans.filter((s) => s.parentSpanId === root.spanId);
    expect(children.map((s) => s.name)).toEqual(["chat spec", "chat implement"]);
    const impl = children[1]!;
    expect(impl.status).toBe("ok");
    expect(impl.attributes["gen_ai.system"]).toBe("codex");
    expect(impl.attributes["gen_ai.request.model"]).toBe("gpt-6-astra");
    expect(impl.attributes["kunpeng.tokens"]).toBe(11);
    expect(impl.endMs).toBeGreaterThanOrEqual(impl.startMs);
    expect(root.startMs).toBeLessThanOrEqual(children[0]!.startMs);
    expect(root.endMs).toBeGreaterThanOrEqual(impl.endMs);
  });

  test("验收失败回滚：根 span error、状态 rolled-back", async () => {
    const result = await new DevCycle({ store, ws, runner: new Runner(FAIL), tracker, flowId: "sp-rb" }).run("写 result.txt");
    expect(result.status).toBe("rolled-back");
    const root = (await spansOf("sp-rb")).find((s) => s.name === ROOT_SPAN_NAME)!;
    expect(root.status).toBe("error");
    expect(root.attributes["kunpeng.flow.status"]).toBe("rolled-back");
  });

  test("agent 调用抛错：该子 span error，根 span 也收尾为 error", async () => {
    await expect(new DevCycle({ store, ws, runner: new Runner(PASS, "implement"), tracker, flowId: "sp-boom" }).run("写 result.txt")).rejects.toThrow();
    const spans = await spansOf("sp-boom");
    const root = spans.find((s) => s.name === ROOT_SPAN_NAME)!;
    expect(root.status).toBe("error");
    const impl = spans.find((s) => s.name === "chat implement")!;
    expect(impl.status).toBe("error");
    expect(impl.parentSpanId).toBe(root.spanId);
  });
});