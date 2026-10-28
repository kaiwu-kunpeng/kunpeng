import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../src/artifacts/store.js";
import { Workspace } from "../src/git/workspace.js";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { FakeRunner } from "../src/agent/runner.js";
import { runPlan } from "../src/plan/orchestrator.js";
import type { PlanModel } from "../src/plan/types.js";

let repo: string;
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-plan-"));
  const g = simpleGit(repo);
  await g.init(); await g.addConfig("user.email", "t@t.t"); await g.addConfig("user.name", "t");
  writeFileSync(join(repo, "README.md"), "base\n"); await g.add("."); await g.commit("init");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

function deps() {
  return {
    repoRoot: repo,
    store: new ArtifactStore(join(repo, ".kunpeng", "artifacts")),
    ws: new Workspace(repo),
    tracker: new FlowTracker(join(repo, ".kunpeng", "state")),
    runner: new FakeRunner({
      spec: { text: "## acc\n- ok", meta: {} },
      implement: { text: "code", meta: {} },
    }),
    concurrency: 2,
  };
}

const okModel: PlanModel = {
  phases: [
    { title: "p0", flows: [{ id: "p0-0-0", title: "a", requirement: "do a", acceptanceCmd: "node -e \"process.exit(0)\"" }] },
    { title: "p1", flows: [{ id: "p1-1-0", title: "b", requirement: "do b", acceptanceCmd: "node -e \"process.exit(0)\"" }] },
  ],
};

test("all phases verified → integration branch holds everything, plan gate set, main untouched", async () => {
  const g = simpleGit(repo);
  const mainBefore = await g.revparse(["HEAD"]);
  const r = await runPlan(okModel, deps());
  expect(r.status).toBe("verified");
  expect(r.integrationBranch).toBe(`kp/${r.planId}`);
  expect(r.flows.map((f) => f.status)).toEqual(["verified", "verified"]);
  expect(r.flows.map((f) => f.phase)).toEqual([0, 1]);

  const branches = (await g.branchLocal()).all;
  expect(branches).toContain(`kp/${r.planId}`);
  // default 分支(main) 全程未被改
  expect(await g.revparse(["HEAD"])).toBe(mainBefore);
  // 终点单门：plan 级 flow 状态挂「合并主干」、指向集成分支
  const gateFs = await new FlowTracker(join(repo, ".kunpeng", "state")).read(r.planId);
  expect(gateFs?.humanGate?.gate).toContain("合并主干");
  expect(gateFs?.humanGate?.what).toContain(`kp/${r.planId}`);
});

test("a flow failing in a phase stops the plan; later phase never starts", async () => {
  const failModel: PlanModel = {
    phases: [
      { title: "p0", flows: [{ id: "p0-0-0", title: "a", requirement: "do a", acceptanceCmd: "node -e \"process.exit(1)\"" }] },
      { title: "p1", flows: [{ id: "p1-1-0", title: "b", requirement: "do b", acceptanceCmd: "node -e \"process.exit(0)\"" }] },
    ],
  };
  const r = await runPlan(failModel, deps());
  expect(r.status).toBe("stopped");
  expect(r.stoppedAtPhase).toBe(0);
  // 第二段从未起：p1-1-0 无 flow 状态
  const fs = await new FlowTracker(join(repo, ".kunpeng", "state")).read("p1-1-0");
  expect(fs).toBeNull();
});

test("phase order: both flows verified and tagged with their phase index", async () => {
  const r = await runPlan(okModel, deps());
  expect(r.flows.map((f) => f.status)).toEqual(["verified", "verified"]);
  expect(r.flows.map((f) => f.phase)).toEqual([0, 1]);
});
