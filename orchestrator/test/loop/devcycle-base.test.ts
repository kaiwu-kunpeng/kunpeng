import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { FakeRunner } from "../../src/agent/runner.js";
import { Workspace } from "../../src/git/workspace.js";
import { DevCycle } from "../../src/loop/dev-cycle.js";

let repo: string;
let store: ArtifactStore;
let ws: Workspace;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-devcycle-base-"));
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  writeFileSync(join(repo, "README.md"), "base\n");
  await g.add(".");
  await g.commit("init");
  store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
  ws = new Workspace(repo);
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

const passingRunner = () => new FakeRunner({
  spec: { text: "## acceptance\n- ok", meta: { testCmd: "node -e \"process.exit(0)\"", marker: "kept" } },
  implement: { text: "done", meta: {} },
});

test("records resolved base commit in spec meta and calls resolver with flow worktree path", async () => {
  const seenCwds: string[] = [];
  const dc = new DevCycle({
    store,
    ws,
    runner: passingRunner(),
    flowId: "base-recorded",
    resolveBase: async (cwd) => {
      seenCwds.push(cwd);
      return "base-sha-123";
    },
  });

  const result = await dc.run("record base");

  expect(result.status).toBe("verified");
  const spec = await store.read("base-recorded");
  expect(spec.meta.baseCommit).toBe("base-sha-123");
  expect(spec.meta.testCmd).toBe("node -e \"process.exit(0)\"");
  expect(spec.meta.marker).toBe("kept");
  expect(seenCwds).toEqual([join(repo, ".kunpeng", "wt", "base-recorded")]);
});

test("does not add baseCommit when resolveBase is not injected", async () => {
  const dc = new DevCycle({
    store,
    ws,
    runner: passingRunner(),
    flowId: "base-not-injected",
  });

  const result = await dc.run("no resolver");

  expect(result.status).toBe("verified");
  const spec = await store.read("base-not-injected");
  expect(Object.prototype.hasOwnProperty.call(spec.meta, "baseCommit")).toBe(false);
  expect(spec.meta.testCmd).toBe("node -e \"process.exit(0)\"");
});

test("continues without baseCommit when resolveBase throws", async () => {
  const dc = new DevCycle({
    store,
    ws,
    runner: passingRunner(),
    flowId: "base-throws",
    resolveBase: async () => {
      throw new Error("cannot resolve base");
    },
  });

  const result = await dc.run("resolver throws");

  expect(result.status).toBe("verified");
  const spec = await store.read("base-throws");
  expect(Object.prototype.hasOwnProperty.call(spec.meta, "baseCommit")).toBe(false);
  expect(spec.meta.testCmd).toBe("node -e \"process.exit(0)\"");
});
