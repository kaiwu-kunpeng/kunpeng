import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { FakeRunner } from "../../src/agent/runner.js";
import { Workspace } from "../../src/git/workspace.js";
import { DevCycle } from "../../src/loop/dev-cycle.js";
import { FLOWSTATE_SCHEMA_VERSION, FlowTracker, migrateFlowState } from "../../src/runtime/flowstate.js";
import { goalBucket } from "../../src/goals/store.js";

// 本文件整体嵌在 spec 围栏里,正文不能出现三个反引号。
const FENCE = "`".repeat(3);
const REQ = ["# 在 src/in 下改文件", "", `${FENCE}scope`, "allow: src/in/**", FENCE].join("\n");
const ACCEPT = "mkdir -p src/in && echo a > src/in/a.ts && grep -q base README.md";

let repo: string;
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-goal-flow-"));
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

function makeCycle(flowId: string, goalId?: string): DevCycle {
  return new DevCycle({
    store: new ArtifactStore(join(repo, ".kunpeng", "artifacts")),
    ws: new Workspace(repo),
    tracker: new FlowTracker(join(repo, ".kunpeng", "state")),
    runner: new FakeRunner({ spec: { text: "## acceptance\n- ok", meta: {}, backend: "claude" }, implement: { text: "done", meta: {}, backend: "claude" } }),
    flowId,
    acceptanceCmd: ACCEPT,
    ...(goalId ? { goalId } : {}),
  });
}

test("带 goalId 的流落盘 goalId 与结构版本 2；不带的进未归属桶", async () => {
  expect(FLOWSTATE_SCHEMA_VERSION).toBe(2);
  expect((await makeCycle("g-yes", "goal-seo-30").run(REQ)).status).toBe("verified");
  expect((await makeCycle("g-no").run(REQ)).status).toBe("verified");
  const t = new FlowTracker(join(repo, ".kunpeng", "state"));
  const yes = (await t.read("g-yes"))!;
  const no = (await t.read("g-no"))!;
  expect(yes.goalId).toBe("goal-seo-30");
  expect(yes.schemaVersion).toBe(2);
  expect(no.goalId).toBeUndefined();
  expect(goalBucket(yes)).toBe("goal-seo-30");
  expect(goalBucket(no)).toBe("未归属");
});

test("v1 旧记录迁移到 v2：版本号提升、goalId 缺省、其它字段不丢", () => {
  const legacy = { flowId: "old", requirement: "r", stage: "done", status: "verified", agentActive: false, startedAt: 1, updatedAt: 2, history: [], schemaVersion: 1, tokensUsed: 7 };
  const out = migrateFlowState(legacy);
  expect(out.schemaVersion).toBe(2);
  expect(out.goalId).toBeUndefined();
  expect(out.tokensUsed).toBe(7);
  expect(goalBucket(out)).toBe("未归属");
});