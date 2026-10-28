import { afterEach, beforeEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../src/artifacts/store.js";
import { CliRunner } from "../src/agent/cli-runner.js";
import { Workspace } from "../src/git/workspace.js";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { createContext } from "../src/sdk/context.js";

let repo: string;
let home: string;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-context-reclaim-repo-"));
  home = mkdtempSync(join(tmpdir(), "kp-context-reclaim-home-"));

  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  writeFileSync(join(repo, "README.md"), "base\n");
  await g.add(".");
  await g.commit("init");

  mkdirSync(join(home, ".kunpeng"), { recursive: true });
  writeFileSync(join(home, ".kunpeng", "accounts.json"), JSON.stringify([
    { id: "acct-a", limit: 10, windowHours: 2 },
  ]));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test("createContext reclaims dead locks before returning the assembled context", async () => {
  const flowId = "dead-on-startup";
  const lockPath = join(repo, ".kunpeng", "locks", `${flowId}.lock`);
  mkdirSync(lockPath, { recursive: true });
  writeFileSync(join(lockPath, "meta.json"), `${JSON.stringify({
    schema: "kunpeng-lock/v1",
    pid: 2_147_483_647,
    host: os.hostname(),
    flowId,
    startedAt: new Date().toISOString(),
  }, null, 2)}\n`);

  const ctx = await createContext(repo, home);

  expect(existsSync(lockPath)).toBe(false);
  expect(ctx.store).toBeInstanceOf(ArtifactStore);
  expect(ctx.ws).toBeInstanceOf(Workspace);
  expect(ctx.runner).toBeInstanceOf(CliRunner);
  expect(ctx.tracker).toBeInstanceOf(FlowTracker);
});
