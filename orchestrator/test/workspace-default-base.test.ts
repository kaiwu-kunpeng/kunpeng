import { afterEach, beforeEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { Workspace } from "../src/git/workspace.js";

let repo: string;
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-defbase-"));
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  writeFileSync(join(repo, "README.md"), "base\n");
  await g.add(".");
  await g.commit("init");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("无 base 时默认 fork off 本地 main，而非当前(陈旧)HEAD", async () => {
  const g = simpleGit(repo);
  await g.raw(["branch", "-M", "main"]);
  // main 上加一个独有提交(标记文件)
  writeFileSync(join(repo, "on-main.txt"), "main-only\n");
  await g.add(".");
  await g.commit("main commit");
  // 切到陈旧 work 分支(停在 main 之前一个提交),当前 HEAD=work(没有 on-main.txt)
  await g.checkoutBranch("work", "HEAD~1");
  expect(existsSync(join(repo, "on-main.txt"))).toBe(false);

  const ws = new Workspace(repo);
  const flow = await ws.acquire("nobase");
  // 关键:worktree 应基于 main(含 on-main.txt),不是当前 work HEAD
  expect(existsSync(join(flow.path, "on-main.txt"))).toBe(true);
  expect(flow.branch).toBe("kp/nobase");
  await ws.release(flow.id);
});

test("显式给 base 时仍 fork off 该 base(行为不变)", async () => {
  const g = simpleGit(repo);
  await g.raw(["branch", "-M", "main"]);
  writeFileSync(join(repo, "on-main.txt"), "m\n");
  await g.add("."); await g.commit("main commit");
  // 造一个 feature 分支,含独有文件
  await g.checkoutBranch("feature", "main");
  writeFileSync(join(repo, "on-feature.txt"), "f\n");
  await g.add("."); await g.commit("feature commit");
  await g.checkout("main");

  const ws = new Workspace(repo);
  const flow = await ws.acquire("withbase", "feature");
  expect(existsSync(join(flow.path, "on-feature.txt"))).toBe(true);
  await ws.release(flow.id);
});

test("无 main 分支的仓:无 base 回退当前 HEAD(不崩、不破坏)", async () => {
  const g = simpleGit(repo);
  await g.raw(["branch", "-M", "trunk"]); // 默认分支不是 main,且无 main
  const ws = new Workspace(repo);
  const flow = await ws.acquire("nomain");
  expect(flow.branch).toBe("kp/nomain");
  expect(existsSync(join(flow.path, "README.md"))).toBe(true);
  await ws.release(flow.id);
});