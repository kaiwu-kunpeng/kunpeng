import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../src/artifacts/store.js";
import { FakeRunner } from "../src/agent/runner.js";
import { Workspace } from "../src/git/workspace.js";
import { DevCycle } from "../src/loop/dev-cycle.js";
import { FlowTracker } from "../src/runtime/flowstate.js";

let repo: string;
let store: ArtifactStore;
let ws: Workspace;
let tracker: FlowTracker;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-flow-backend-"));
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  writeFileSync(join(repo, "README.md"), "base\n");
  await g.add(".");
  await g.commit("init");
  store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
  ws = new Workspace(repo);
  tracker = new FlowTracker(join(repo, ".kunpeng", "state"));
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("DevCycle writes actual backend from runner results into FlowState", async () => {
  const runner = new FakeRunner({
    spec: { text: "## acceptance\n- ok", meta: { testCmd: "node -e \"process.exit(0)\"" }, backend: "claude" },
    implement: { text: "done", meta: {}, backend: "codex" },
  });

  const dc = new DevCycle({ store, ws, runner, flowId: "fb1", tracker });
  const result = await dc.run("record backend");
  const state = await tracker.read("fb1");

  expect(result.status).toBe("verified");
  expect(state?.backend).toBe("codex");
  expect(state?.fellBack).toBeUndefined();
});

test("DevCycle persists fallback marker when runner reports fallback", async () => {
  const runner = new FakeRunner({
    spec: { text: "## acceptance\n- ok", meta: { testCmd: "node -e \"process.exit(0)\"" }, backend: "claude" },
    implement: { text: "done", meta: {}, backend: "claude", fellBack: true },
  });

  const dc = new DevCycle({ store, ws, runner, flowId: "fb2", tracker });
  const result = await dc.run("record fallback");
  const state = await tracker.read("fb2");

  expect(result.status).toBe("verified");
  expect(state?.backend).toBe("claude");
  expect(state?.fellBack).toBe(true);
});
