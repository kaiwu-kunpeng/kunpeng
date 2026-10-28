import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { FakeRunner } from "../../src/agent/runner.js";
import { Workspace } from "../../src/git/workspace.js";
import { DevCycle } from "../../src/loop/dev-cycle.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";

// 本文件整体嵌在 spec 围栏里,正文不能出现三个反引号。
const FENCE = "`".repeat(3);
const REQ = ["# 在 src/in 下改文件", "", `${FENCE}scope`, "allow: src/in/**", FENCE].join("\n");
// 验收命令把自己看到的 TMPDIR 写进范围内文件，并在里面写一个临时文件证明可写。
const ACCEPT = 'mkdir -p src/in && printf "%s" "$TMPDIR" > src/in/tmp.txt && touch "$TMPDIR/probe.txt" && grep -q kunpeng-flows src/in/tmp.txt && grep -q base README.md';

let repo: string;
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-dc-tmp-"));
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

describe("验收命令跑在每流独立 TMPDIR 里（作者锁定）", () => {
  test("TMPDIR 指向 kunpeng-flows/<flowId>，且流结束后随 worktree 清理", async () => {
    const flowId = "tmp-iso-1";
    const r = await new DevCycle({
      store: new ArtifactStore(join(repo, ".kunpeng", "artifacts")),
      ws: new Workspace(repo),
      tracker: new FlowTracker(join(repo, ".kunpeng", "state")),
      runner: new FakeRunner({ spec: { text: "## acceptance\n- ok", meta: {}, backend: "claude" }, implement: { text: "done", meta: {}, backend: "claude" } }),
      flowId,
      acceptanceCmd: ACCEPT,
    }).run(REQ);
    expect(r.status).toBe("verified");
    const seen = await simpleGit(repo).show([`kp/${flowId}:src/in/tmp.txt`]);
    expect(seen).toContain(join("kunpeng-flows", flowId));
  });
});