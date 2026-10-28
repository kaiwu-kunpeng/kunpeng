import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../src/artifacts/store.js";
import { FakeRunner } from "../src/agent/runner.js";
import { Workspace } from "../src/git/workspace.js";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { runPlan } from "../src/plan/orchestrator.js";
import type { KunpengEvent } from "../src/sdk/events.js";
import type { PlanModel } from "../src/plan/types.js";

let repo: string;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-plan-events-"));
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  writeFileSync(join(repo, "README.md"), "base\n");
  await g.add(".");
  await g.commit("init");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

function deps(events: KunpengEvent[]) {
  return {
    repoRoot: repo,
    store: new ArtifactStore(join(repo, ".kunpeng", "artifacts")),
    ws: new Workspace(repo),
    tracker: new FlowTracker(join(repo, ".kunpeng", "state")),
    runner: new FakeRunner({
      spec: { text: "## acc\n- ok", meta: {} },
      implement: { text: "code", meta: {} },
    }),
    concurrency: 1,
    onEvent: (event: KunpengEvent) => events.push(event),
  };
}

test("runPlan emits phase events, forwards flow events with planId, then emits gate and plan done", async () => {
  const events: KunpengEvent[] = [];
  const model: PlanModel = {
    phases: [
      { title: "p0", flows: [{ id: "p0-flow", title: "a", requirement: "do a", acceptanceCmd: "node -e \"process.exit(0)\"" }] },
      { title: "p1", flows: [{ id: "p1-flow", title: "b", requirement: "do b", acceptanceCmd: "node -e \"process.exit(0)\"" }] },
    ],
  };

  const result = await runPlan(model, deps(events));

  expect(result.status).toBe("verified");
  const planId = result.planId;
  const eventKeys = events.map((event) => {
    if (event.type === "phase") return `phase:${event.phase}`;
    if (event.type === "flow") return `flow:${event.flowId}:${event.stage}`;
    if (event.type === "gate") return "gate";
    if (event.type !== "done") throw new Error(`Unexpected event: ${event.type}`);
    return event.flowId ? `done:${event.flowId}:${event.status}` : `done:${event.status}`;
  });

  expect(eventKeys).toEqual([
    "phase:p0",
    "flow:p0-flow:spec",
    "flow:p0-flow:audit",
    "flow:p0-flow:implement",
    "flow:p0-flow:verify",
    "done:p0-flow:verified",
    "phase:p1",
    "flow:p1-flow:spec",
    "flow:p1-flow:audit",
    "flow:p1-flow:implement",
    "flow:p1-flow:verify",
    "done:p1-flow:verified",
    "gate",
    "done:verified",
  ]);
  expect(events.every((event) => ("planId" in event ? event.planId === planId : true))).toBe(true);
  expect(events.filter((event) => event.type === "phase")).toEqual([
    { type: "phase", planId, phase: "p0", index: 0, total: 2 },
    { type: "phase", planId, phase: "p1", index: 1, total: 2 },
  ]);
  expect(events.at(-2)).toMatchObject({
    type: "gate",
    planId,
    what: "合并主干 (人工门#1)",
  });
  expect(events.at(-2)).toHaveProperty("detail", expect.stringContaining(`${result.integrationBranch} → `));
  expect(events.at(-1)).toEqual({ type: "done", planId, status: "verified" });
});
