import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts/store.js";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { collectState } from "../src/server/dashboard.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-dash-backend-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("collectState exposes backend and fallback marker for running flows and agent assignments", async () => {
  const store = new ArtifactStore(join(dir, ".kunpeng", "artifacts"));
  const tracker = new FlowTracker(join(dir, ".kunpeng", "state"));

  await tracker.start("flow-backend", "show backend in dashboard");
  await tracker.enter("flow-backend", "implement", true);
  await tracker.setBackend("flow-backend", "claude", true);

  const state = await collectState(store, dir);
  const running = state.running.find((f) => f.flowId === "flow-backend");
  const assignment = state.agentAssignments.find((a) => a.doing === "flow-backend @ implement");

  expect(running?.backend).toBe("claude");
  expect(running?.fellBack).toBe(true);
  expect(assignment?.backend).toBe("claude");
  expect(assignment?.fellBack).toBe(true);
});
