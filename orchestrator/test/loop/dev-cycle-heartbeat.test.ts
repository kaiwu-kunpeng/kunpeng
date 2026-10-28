import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../../src/artifacts/store.js";
import type { AgentRequest, AgentResult, AgentRunner } from "../../src/agent/runner.js";
import type { StreamDelta } from "../../src/agent/cli-stream-parse.js";
import { Workspace } from "../../src/git/workspace.js";
import { DevCycle } from "../../src/loop/dev-cycle.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { leaseTtlForStage } from "../../src/runtime/lease-policy.js";

let repo: string;
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-heartbeat-"));
  const git = simpleGit(repo);
  await git.init();
  await git.addConfig("user.email", "t@t.t");
  await git.addConfig("user.name", "t");
  await git.checkoutLocalBranch("main");
  writeFileSync(join(repo, "README.md"), "base\n");
  await git.add(".");
  await git.commit("init");
});
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

/** 流式 runner：每个阶段先回调 onSpawn(4242)，再吐两条 delta，期间把状态快照下来。 */
class StreamingRunner implements AgentRunner {
  seenAgentPid: (number | undefined)[] = [];
  constructor(private readonly tracker: FlowTracker, private readonly flowId: string) {}
  async run(req: AgentRequest): Promise<AgentResult> { return this.runStreaming(req, () => {}); }
  async runStreaming(req: AgentRequest, onDelta: (d: StreamDelta) => void): Promise<AgentResult> {
    req.onSpawn?.(4242);
    this.seenAgentPid.push((await this.tracker.read(this.flowId))?.agentPid);
    onDelta({ text: "x" } as StreamDelta);
    onDelta({ text: "y" } as StreamDelta);
    return { text: req.stage === "spec" ? "## acceptance\n- ok" : "done", meta: {}, backend: "claude" };
  }
}

describe("DevCycle 心跳与 agent pid（作者锁定）", () => {
  test("每次调后端前续租（ttl 按阶段）、子进程 pid 在调用期间可见、调用结束即清空", async () => {
    const tracker = new FlowTracker(join(repo, ".kunpeng", "state"));
    const runner = new StreamingRunner(tracker, "hb");
    const before = Date.now();
    const dc = new DevCycle({
      store: new ArtifactStore(join(repo, ".kunpeng", "artifacts")),
      ws: new Workspace(repo),
      tracker,
      runner,
      flowId: "hb",
      acceptanceCmd: "grep -q base README.md",
    });
    const result = await dc.run("心跳测试");
    expect(result.status).toBe("verified");
    const s = (await tracker.read("hb"))!;
    expect(s.lease).toBeDefined();
    expect(s.lease!.renewedAt).toBeGreaterThanOrEqual(before);
    expect(s.lease!.ttlMs).toBe(leaseTtlForStage("implement"));
    expect(runner.seenAgentPid).toEqual([4242, 4242]);
    expect(s.agentPid).toBeUndefined();
  });
});