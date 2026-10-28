import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { afterEach, beforeEach, expect, test } from "vitest";
import { Workspace } from "../../src/git/workspace.js";
import { INSTANCE_FILE } from "../../src/switchboard/identity.js";
import { runWorkspaceCommand } from "../../src/runtime/workspace-cli.js";

let repo: string;
let ws: Workspace;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-workspace-cli-"));
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  writeFileSync(join(repo, "README.md"), "base\n");
  await g.add(".");
  await g.commit("init");
  ws = new Workspace(repo);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

test("acquire creates a worktree, writes .kunpeng-instance, and creates kp/<id> branch", async () => {
  const result = await runWorkspaceCommand(["acquire", "flow-a"], ws);

  expect(result.ok).toBe(true);
  expect(result.id).toBe("flow-a");
  expect(result.path).toBe(join(repo, ".kunpeng", "wt", "flow-a"));
  expect(result.branch).toBe("kp/flow-a");
  expect(existsSync(result.path!)).toBe(true);
  expect(readFileSync(join(result.path!, INSTANCE_FILE), "utf8")).toBe("flow-a\n");

  const branches = await simpleGit(repo).branchLocal();
  expect(branches.all).toContain("kp/flow-a");
});

test("release removes the worktree but keeps the branch", async () => {
  const acquired = await runWorkspaceCommand(["acquire", "flow-release"], ws);

  const result = await runWorkspaceCommand(["release", "flow-release"], ws);

  expect(result).toEqual({ ok: true, id: "flow-release" });
  expect(existsSync(acquired.path!)).toBe(false);
  const branches = await simpleGit(repo).branchLocal();
  expect(branches.all).toContain("kp/flow-release");
});

test("abandon removes the worktree and deletes the branch", async () => {
  const acquired = await runWorkspaceCommand(["acquire", "flow-abandon"], ws);

  const result = await runWorkspaceCommand(["abandon", "flow-abandon"], ws);

  expect(result).toEqual({ ok: true, id: "flow-abandon" });
  expect(existsSync(acquired.path!)).toBe(false);
  const branches = await simpleGit(repo).branchLocal();
  expect(branches.all).not.toContain("kp/flow-abandon");
});

test("missing id returns usage error", async () => {
  const result = await runWorkspaceCommand(["acquire"], ws);

  expect(result.ok).toBe(false);
  expect(result.id).toBe("");
  expect(result.error).toContain("用法: kunpeng workspace <acquire|release|abandon> <id> [base]");
});

test("unknown action returns an action error", async () => {
  const result = await runWorkspaceCommand(["destroy", "flow-x"], ws);

  expect(result).toEqual({ ok: false, id: "flow-x", error: "未知 workspace 动作: destroy" });
});
