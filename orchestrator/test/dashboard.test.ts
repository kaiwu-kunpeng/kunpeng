import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts/store.js";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { collectState } from "../src/server/dashboard.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-dash-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("collectState groups artifacts by kind and counts statuses", async () => {
  const store = new ArtifactStore(join(dir, "artifacts"));
  await store.write({ kind: "spec", id: "s1", status: "verified", body: "# build login\n...", meta: {} });
  await store.write({ kind: "review", id: "guard-1", status: "draft", body: "- [info] x", meta: {} });
  await store.write({ kind: "spec", id: "s2", status: "rolled-back", body: "# broken", meta: {} });
  const state = await collectState(store, dir);
  expect(state.artifacts.spec).toHaveLength(2);
  expect(state.artifacts.review).toHaveLength(1);
  expect(state.statusCounts.verified).toBe(1);
  expect(state.statusCounts["rolled-back"]).toBe(1);
  expect(state.artifacts.spec[0].summary).toContain("build login");
});

test("collectState derives agents, humanGates, blockers, and running from flow state", async () => {
  // Use the same repoRoot for both store and tracker as collectState expects
  const store = new ArtifactStore(join(dir, ".kunpeng", "artifacts"));
  const tracker = new FlowTracker(join(dir, ".kunpeng", "state"));

  // Write a draft proposal artifact → should appear as humanGate#2
  await store.write({ kind: "proposal", id: "evolve-abc", status: "draft", body: "change conventions", meta: {} });

  // Write a running flow with agentActive=true
  await tracker.start("flow-1", "build feature X");
  await tracker.enter("flow-1", "implement", true);

  // Write a rolled-back flow that hit a blocker before rolling back.
  // finish() 清掉 blocker（终态 = 已解决）：回滚流不再是「活跃卡点」，其原因留在 history/experience。
  await tracker.start("flow-2", "broken task");
  await tracker.block("flow-2", "审计未通过");
  await tracker.finish("flow-2", "rolled-back");

  // Write a verified flow with a human gate (merge gate)
  await tracker.start("flow-3", "completed thing");
  await tracker.finish("flow-3", "verified", { gate: "合并主干 (人工门#1)", what: "kp/flow-3 → main" });

  // Write a crashed flow → genuine *unresolved* blocker, must still surface as 卡点。
  await tracker.start("flow-4", "crashed task");
  await tracker.markCrashed("flow-4");

  const state = await collectState(store, dir);

  // agents = 1 (main) + 1 (flow-1 is running and agentActive)
  expect(state.agents).toBe(2);

  // running flows: only flow-1
  expect(state.running).toHaveLength(1);
  expect(state.running[0].flowId).toBe("flow-1");

  // blockers: 回滚的 flow-2 已是终态、不再算卡点；只有未解决的 crashed flow-4 暴露为卡点。
  expect(state.blockers).toHaveLength(1);
  expect(state.blockers[0].flowId).toBe("flow-4");
  expect(state.blockers[0].reason).toContain("崩溃");

  // humanGates: flow-3 merge gate + evolve-abc proposal
  const gateWhats = state.humanGates.map((g) => g.what);
  expect(gateWhats).toContain("合并主干 (人工门#1)");
  expect(gateWhats).toContain("批准进化提案 (人工门#2)");
  const proposalGate = state.humanGates.find((g) => g.detail === "evolve-abc");
  expect(proposalGate).toBeTruthy();
});

test("collectState: systemLight=yellow when review has warn finding, no blocker", async () => {
  const store = new ArtifactStore(join(dir, ".kunpeng", "artifacts"));
  const tracker = new FlowTracker(join(dir, ".kunpeng", "state"));

  // A finished flow (to give avgMs a baseline)
  const now = Date.now();
  await tracker.start("flow-done", "some finished task");
  // Simulate it having started 60s ago and finished 5s ago
  const doneState = await tracker.read("flow-done");
  if (doneState) {
    doneState.startedAt = now - 60000;
    doneState.updatedAt = now - 5000;
    doneState.status = "verified";
    doneState.stage = "done";
    // write back via internal - use tracker finish but patch via start trick
  }
  // Just write a finished flow manually via store approach
  await tracker.start("flow-fin", "finished task");
  await tracker.finish("flow-fin", "verified");

  // A running flow
  await tracker.start("flow-run", "running task");
  await tracker.enter("flow-run", "implement", true);

  // A review artifact with a warn finding
  await store.write({
    kind: "review",
    id: "guard-warn",
    status: "draft",
    body: "review body",
    meta: { findings: [{ severity: "warn", message: "something off" }] },
  });

  // A draft proposal
  await store.write({ kind: "proposal", id: "prop-1", status: "draft", body: "proposal", meta: {} });

  const state = await collectState(store, dir);

  // No blocker/rolled-back → not red; has warn finding → yellow
  expect(state.systemLight).toBe("yellow");

  // Running flow should have etaRemainingMs as a number
  const runningFlow = state.running.find((f) => f.flowId === "flow-run");
  expect(runningFlow).toBeDefined();
  expect(typeof runningFlow!.etaRemainingMs).toBe("number");

  // agentAssignments[0] is 主 agent
  expect(state.agentAssignments[0].agent).toBe("主 agent");

  // Per-flow light present on all flows
  for (const f of state.flows) {
    expect(f.light === "red" || f.light === "green").toBe(true);
  }
});

test("collectState: systemLight=red and flow light=red when flow has blocker", async () => {
  const store = new ArtifactStore(join(dir, ".kunpeng", "artifacts"));
  const tracker = new FlowTracker(join(dir, ".kunpeng", "state"));

  await tracker.start("flow-blocked", "blocked task");
  await tracker.block("flow-blocked", "test failure");

  const state = await collectState(store, dir);

  expect(state.systemLight).toBe("red");

  const blockedFlow = state.flows.find((f) => f.flowId === "flow-blocked");
  expect(blockedFlow).toBeDefined();
  expect(blockedFlow!.light).toBe("red");
});

test("FlowTracker.clearGate removes humanGate and appends history", async () => {
  const tracker = new FlowTracker(join(dir, "state"));
  await tracker.start("flow-g", "gate flow");
  await tracker.finish("flow-g", "verified", { gate: "合并主干 (人工门#1)", what: "kp/flow-g → main" });

  let s = await tracker.read("flow-g");
  expect(s?.humanGate).toBeDefined();

  await tracker.clearGate("flow-g");

  s = await tracker.read("flow-g");
  expect(s?.humanGate).toBeUndefined();
  expect(s?.history.some((h) => h.stage === "gate-cleared")).toBe(true);
});
