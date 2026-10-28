import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../../src/artifacts/store.js";
import type { Artifact, ArtifactStatus } from "../../src/artifacts/types.js";
import { FakeRunner, type AgentRequest, type AgentResult, type AgentRunner } from "../../src/agent/runner.js";
import { Workspace } from "../../src/git/workspace.js";
import { DevCycle } from "../../src/loop/dev-cycle.js";
import { runPlan } from "../../src/plan/orchestrator.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";

/** 转 rolled-back 时落盘失败的产物库（模拟磁盘满 / 权限错），其余转换照常。 */
class RollbackBrokenStore extends ArtifactStore {
  constructor(dir: string, private readonly broken: (id: string) => boolean) { super(dir); }
  override async transition(id: string, to: ArtifactStatus): Promise<Artifact> {
    if (to === "rolled-back" && this.broken(id)) throw new Error("状态落盘失败 EACCES");
    return super.transition(id, to);
  }
}

class BoomRunner implements AgentRunner {
  async run(req: AgentRequest): Promise<AgentResult> {
    if (req.stage === "implement") throw new Error("后端炸了");
    return { text: "## acceptance\n- ok", meta: {}, backend: "claude" };
  }
}

let repo: string;
let warn: import("vitest").MockInstance<(...args: unknown[]) => void>;
let savedEval: string | undefined;

beforeEach(async () => {
  savedEval = process.env.KUNPENG_VERIFY_EVALUATOR;
  process.env.KUNPENG_VERIFY_EVALUATOR = "0";
  repo = mkdtempSync(join(tmpdir(), "kp-rb-warn-"));
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  await g.checkoutLocalBranch("main");
  writeFileSync(join(repo, "README.md"), "base\n");
  await g.add(".");
  await g.commit("init");
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
  if (savedEval === undefined) delete process.env.KUNPENG_VERIFY_EVALUATOR; else process.env.KUNPENG_VERIFY_EVALUATOR = savedEval;
  rmSync(repo, { recursive: true, force: true });
});

const warned = () => warn.mock.calls.map((args) => args.map(String).join(" ")).join("\n");

describe("标记 rolled-back 失败不再静默（作者锁定）", () => {
  test("dev-cycle 异常分支：transition 抛错 → console.warn 带 flowId 与错误摘要，原异常照常抛出", async () => {
    const flowId = "ghost-flow-1";
    const dc = new DevCycle({
      store: new RollbackBrokenStore(join(repo, ".kunpeng", "artifacts"), () => true),
      ws: new Workspace(repo),
      tracker: new FlowTracker(join(repo, ".kunpeng", "state")),
      runner: new BoomRunner(),
      flowId,
      acceptanceCmd: 'node -e "process.exit(0)"',
    });
    await expect(dc.run("写 result.txt")).rejects.toThrow("后端炸了");
    const text = warned();
    expect(text).toContain(flowId);
    expect(text).toContain("状态落盘失败 EACCES");
  });

  test("plan 段失败停段：plan 转 rolled-back 抛错 → console.warn 带 planId 与错误摘要", async () => {
    const r = await runPlan(
      { phases: [{ title: "p0", flows: [{ id: "p0-0-0", title: "a", requirement: "do a", acceptanceCmd: 'node -e "process.exit(1)"' }] }] },
      {
        repoRoot: repo,
        store: new RollbackBrokenStore(join(repo, ".kunpeng", "artifacts"), (id) => id !== "p0-0-0"),
        ws: new Workspace(repo),
        tracker: new FlowTracker(join(repo, ".kunpeng", "state")),
        runner: new FakeRunner({ spec: { text: "## acc\n- ok", meta: {} }, implement: { text: "code", meta: {} } }),
        concurrency: 1,
      },
    );
    expect(r.status).toBe("stopped");
    const text = warned();
    expect(text).toContain(r.planId);
    expect(text).toContain("状态落盘失败 EACCES");
  });
});