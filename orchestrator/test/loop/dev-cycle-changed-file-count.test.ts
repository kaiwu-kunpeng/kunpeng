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
import { flowSaving } from "../../src/metrics/time-saved.js";

// 本文件整体嵌在 spec 围栏里,正文不能出现三个反引号。
const FENCE = "`".repeat(3);
const SCOPED_REQ = ["# 在 src/in 下改三个文件", "", `${FENCE}scope`, "allow: src/in/**", FENCE].join("\n");
const THREE_FILES_CMD = "mkdir -p src/in && echo a > src/in/a.ts && echo b > src/in/b.ts && echo c > src/in/c.ts && grep -q base README.md";
const ONE_FILE_CMD = "mkdir -p src/in && echo a > src/in/a.ts && grep -q base README.md";

let repo: string;
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-changed-count-"));
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

function makeCycle(flowId: string, acceptanceCmd: string, planContext?: { planId: string; phase: number }): DevCycle {
  return new DevCycle({
    store: new ArtifactStore(join(repo, ".kunpeng", "artifacts")),
    ws: new Workspace(repo),
    tracker: new FlowTracker(join(repo, ".kunpeng", "state")),
    runner: new FakeRunner({ spec: { text: "## acceptance\n- ok", meta: {}, backend: "claude" }, implement: { text: "done", meta: {}, backend: "claude" } }),
    flowId,
    acceptanceCmd,
    ...(planContext ? { planContext } : {}),
  });
}

describe("verified 流落盘改动文件数，尺子据此判档（作者锁定）", () => {
  test("独立流：三个文件 → changedFileCount=3 → complex/changedFiles；一个文件 → simple", async () => {
    expect((await makeCycle("cf-three", THREE_FILES_CMD).run(SCOPED_REQ)).status).toBe("verified");
    const tracker = new FlowTracker(join(repo, ".kunpeng", "state"));
    const three = (await tracker.read("cf-three"))!;
    expect(three.changedFileCount).toBe(3);
    const saving = flowSaving({ ...three, requirement: "小改" });
    expect(saving.complexity).toBe("complex");
    expect(saving.complexitySource).toBe("changedFiles");
    expect((await makeCycle("cf-one", ONE_FILE_CMD).run(SCOPED_REQ)).status).toBe("verified");
    expect((await tracker.read("cf-one"))!.changedFileCount).toBe(1);
  });

  test("plan 内子流也落盘（不走逐流范围门，但要数文件）", async () => {
    expect((await makeCycle("cf-child", THREE_FILES_CMD, { planId: "plan-cf", phase: 0 }).run(SCOPED_REQ)).status).toBe("verified");
    expect((await new FlowTracker(join(repo, ".kunpeng", "state")).read("cf-child"))!.changedFileCount).toBe(3);
  });

  test("setChangedFileCount 拒绝非法值，不动 history", async () => {
    const tracker = new FlowTracker(join(repo, ".kunpeng", "state"));
    await tracker.start("cf-x", "x");
    const before = (await tracker.read("cf-x"))!.history.length;
    await tracker.setChangedFileCount("cf-x", -1);
    await tracker.setChangedFileCount("cf-x", Number.NaN);
    await tracker.setChangedFileCount("cf-x", 2.5);
    expect((await tracker.read("cf-x"))!.changedFileCount).toBeUndefined();
    await tracker.setChangedFileCount("cf-x", 0);
    expect((await tracker.read("cf-x"))!.changedFileCount).toBe(0);
    expect((await tracker.read("cf-x"))!.history.length).toBe(before);
  });
});