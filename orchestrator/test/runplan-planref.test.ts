import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../src/artifacts/store.js";
import { FakeRunner } from "../src/agent/runner.js";
import { Workspace } from "../src/git/workspace.js";
import { runPlan } from "../src/plan/orchestrator.js";
import type { PlanModel } from "../src/plan/types.js";
import { FlowTracker } from "../src/runtime/flowstate.js";

let repo: string;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-runplan-planref-"));
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  writeFileSync(join(repo, "README.md"), "base\n");
  await g.add(".");
  await g.commit("init");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("runPlan records planRef in the plan artifact meta", async () => {
  const store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
  const model: PlanModel = {
    phases: [
      {
        title: "p0",
        flows: [
          {
            id: "p0-0-0",
            title: "a",
            requirement: "do a",
            acceptanceCmd: "node -e \"process.exit(0)\"",
          },
        ],
      },
    ],
  };

  const result = await runPlan(model, {
    repoRoot: repo,
    store,
    ws: new Workspace(repo),
    tracker: new FlowTracker(join(repo, ".kunpeng", "state")),
    runner: new FakeRunner({
      spec: { text: "## acc\n- ok", meta: {} },
      implement: { text: "code", meta: {} },
    }),
    now: () => 123456789,
    planRef: "/abs/plan.md",
  });

  expect(result.status).toBe("verified");
  const artifacts = await store.list("plan");
  const planArtifact = artifacts.find((a) => a.id === result.planId);
  expect(planArtifact?.kind).toBe("plan");
  expect(planArtifact?.meta).toMatchObject({
    phases: 1,
    flows: 1,
    planRef: "/abs/plan.md",
  });
});
