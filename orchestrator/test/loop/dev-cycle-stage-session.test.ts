import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../../src/artifacts/store.js";
import type { AgentRequest, AgentResult } from "../../src/agent/runner.js";
import type { StreamDelta } from "../../src/agent/cli-stream-parse.js";
import { Workspace } from "../../src/git/workspace.js";
import { DevCycle } from "../../src/loop/dev-cycle.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";

// 本文件整体嵌在 spec 围栏里,正文不能出现三个反引号。
const FENCE = "`".repeat(3);
const REQ = ["# 在 src/in 下改文件", "", `${FENCE}scope`, "allow: src/in/**", FENCE].join("\n");
const ACCEPT = "mkdir -p src/in && echo a > src/in/a.ts && grep -q base README.md";

let repo: string;
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-stage-session-"));
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

class StreamingFakeRunner {
  backend = "codex";
  async run(req: AgentRequest): Promise<AgentResult> { return this.runStreaming(req, () => {}); }
  async runStreaming(req: AgentRequest, onDelta: (d: StreamDelta) => void): Promise<AgentResult> {
    const backend = req.stage === "implement" ? "codex" : "claude";
    onDelta({ sessionId: `${backend}-session-${req.stage}` });
    onDelta({ text: "x", usage: { input: 10, output: 5 } });
    return { text: req.stage === "spec" ? "## acceptance\n- ok" : "done", meta: {}, backend };
  }
}

test("流式会话 id 按阶段落盘：spec 走 claude，implement 走 codex", async () => {
  const dc = new DevCycle({
    store: new ArtifactStore(join(repo, ".kunpeng", "artifacts")),
    ws: new Workspace(repo),
    tracker: new FlowTracker(join(repo, ".kunpeng", "state")),
    runner: new StreamingFakeRunner() as never,
    flowId: "ss-1",
    acceptanceCmd: ACCEPT,
  });
  expect((await dc.run(REQ)).status).toBe("verified");
  const s = (await new FlowTracker(join(repo, ".kunpeng", "state")).read("ss-1"))!;
  expect(s.stageSessions?.spec).toMatchObject({ backend: "claude", sessionId: "claude-session-spec" });
  expect(s.stageSessions?.implement).toMatchObject({ backend: "codex", sessionId: "codex-session-implement" });
  expect(typeof s.stageSessions?.implement?.at).toBe("number");
  expect(s.tokenQuad?.input).toBeGreaterThan(0);
});