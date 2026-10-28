import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { FakeRunner } from "../../src/agent/runner.js";
import type { AgentRequest, AgentResult, AgentRunner } from "../../src/agent/runner.js";
import { Workspace } from "../../src/git/workspace.js";
import { DevCycle } from "../../src/loop/dev-cycle.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";

// 本文件整体嵌在 spec 围栏里,正文不能出现三个反引号。
const FENCE = "`".repeat(3);
const REQ = ["# 在 src/in 下改文件", "", `${FENCE}scope`, "allow: src/in/**", FENCE].join("\n");
const ACCEPT = "mkdir -p src/in && echo a > src/in/a.ts && grep -q base README.md";
const SPEC: AgentResult = { text: "## acceptance\n- ok", meta: {}, backend: "claude" };

let repo: string;
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-dc-raise-"));
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

class CapturingRunner implements AgentRunner {
  systems: Record<string, string> = {};
  constructor(private inner: FakeRunner) {}
  async run(req: AgentRequest): Promise<AgentResult> {
    this.systems[req.stage] = req.system;
    return this.inner.run(req);
  }
}

function cycle(flowId: string, runner: AgentRunner): DevCycle {
  return new DevCycle({
    store: new ArtifactStore(join(repo, ".kunpeng", "artifacts")),
    ws: new Workspace(repo),
    tracker: new FlowTracker(join(repo, ".kunpeng", "state")),
    runner,
    flowId,
    acceptanceCmd: ACCEPT,
  });
}
const tracker = () => new FlowTracker(join(repo, ".kunpeng", "state"));

describe("DevCycle 求助卡点（作者锁定）", () => {
  test("implement 输出 RAISE_BLOCKER 行 → stopped、blocker 带前缀与原因、不进 verify", async () => {
    const runner = new FakeRunner({
      spec: SPEC,
      implement: { text: "看了 spec，发现迁移需要连库。\nRAISE_BLOCKER: 缺 DATABASE_URL，请给测试库连接串", meta: {}, backend: "claude" },
    });
    const r = await cycle("rb-stop", runner).run(REQ);
    expect(r.status).toBe("stopped");
    expect(r.evidence).toContain("主动求助");
    expect(r.evidence).toContain("缺 DATABASE_URL");
    const s = (await tracker().read("rb-stop"))!;
    expect(s.status).toBe("stopped");
    expect(s.blocker).toBe("raise-blocker: 缺 DATABASE_URL，请给测试库连接串");
    expect(s.history.map((h) => h.stage)).toContain("stopped");
    expect(s.history.map((h) => h.stage)).not.toContain("verify");
  });

  test("runner 已在 meta.blocker 给出原因时优先用它", async () => {
    const runner = new FakeRunner({
      spec: SPEC,
      implement: { text: "（后端已解析）", meta: { blocker: "需要人决定用哪个支付渠道" }, backend: "codex" },
    });
    const r = await cycle("rb-meta", runner).run(REQ);
    expect(r.status).toBe("stopped");
    expect((await tracker().read("rb-meta"))!.blocker).toBe("raise-blocker: 需要人决定用哪个支付渠道");
  });

  test("没有标记 → 行为不变（verified）；implement 的 system 提示含求助说明", async () => {
    const runner = new CapturingRunner(new FakeRunner({ spec: SPEC, implement: { text: "done", meta: {}, backend: "claude" } }));
    const r = await cycle("rb-ok", runner).run(REQ);
    expect(r.status).toBe("verified");
    expect(runner.systems.implement).toContain("RAISE_BLOCKER:");
    expect(runner.systems.spec ?? "").not.toContain("RAISE_BLOCKER:");
  });
});