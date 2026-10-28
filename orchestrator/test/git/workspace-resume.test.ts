import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import { afterEach, beforeEach, expect, test } from "vitest";
import { Workspace } from "../../src/git/workspace.js";

let repo: string;
let g: SimpleGit;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-wt-resume-"));
  g = simpleGit(repo);
  await g.init();
  await g.checkoutLocalBranch("main");
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  writeFileSync(join(repo, "base.txt"), "base\n");
  await g.add(".");
  await g.commit("init");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

test("崩溃后 acquireResume 从 checkpoint 恢复 implement 代码", async () => {
  const ws = new Workspace(repo);
  const flow = await ws.acquire("f1", "main");
  writeFileSync(join(flow.path, "impl.txt"), "implemented\n");
  await ws.checkpoint("f1", "implement");

  // 模拟崩溃:移除 worktree + 锁(分支 kp/f1 残留,tag 存活)。
  await g.raw(["worktree", "remove", "--force", flow.path]);
  rmSync(join(repo, ".kunpeng", "locks", "f1.lock"), { recursive: true, force: true });

  // 新进程续跑
  const ws2 = new Workspace(repo);
  const resumed = await ws2.acquireResume("f1");
  expect(existsSync(join(resumed.path, "impl.txt"))).toBe(true);
  expect(readFileSync(join(resumed.path, "impl.txt"), "utf8")).toContain("implemented");
});

test("无 checkpoint 时 acquireResume 退回从 main 全新分叉(无 implement 文件)", async () => {
  const ws = new Workspace(repo);
  const flow = await ws.acquireResume("fresh");
  expect(existsSync(join(flow.path, "impl.txt"))).toBe(false);
  expect(existsSync(join(flow.path, "base.txt"))).toBe(true);
});