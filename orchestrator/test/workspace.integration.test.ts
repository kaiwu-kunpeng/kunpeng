import { afterEach, beforeEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { Workspace } from "../src/git/workspace.js";

let repo: string;
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-repo-"));
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  writeFileSync(join(repo, "README.md"), "base\n");
  await g.add(".");
  await g.commit("init");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("acquire symlinks node_modules (root + subdir) into the worktree so the toolchain resolves", async () => {
  // 子包目录要被 git 追踪，worktree(off HEAD) 才有它、才能在里面建 node_modules 软链。
  const g = simpleGit(repo);
  mkdirSync(join(repo, "orchestrator"));
  writeFileSync(join(repo, "orchestrator", "package.json"), "{}\n");
  await g.add("."); await g.commit("add orchestrator");
  // 主仓造 node_modules（gitignore 的、不进 worktree）：根级 + 子包级。
  mkdirSync(join(repo, "node_modules", "leftpad"), { recursive: true });
  mkdirSync(join(repo, "orchestrator", "node_modules", "vitest"), { recursive: true });
  const ws = new Workspace(repo);
  const flow = await ws.acquire("nm");
  // worktree 同名相对路径出现 node_modules 软链，内容可达。
  expect(lstatSync(join(flow.path, "node_modules")).isSymbolicLink()).toBe(true);
  expect(existsSync(join(flow.path, "node_modules", "leftpad"))).toBe(true);
  expect(existsSync(join(flow.path, "orchestrator", "node_modules", "vitest"))).toBe(true);
  // 关键：提交时工具链软链绝不入库（dogfood 暴露的泄漏）。
  writeFileSync(join(flow.path, "real.txt"), "real change\n");
  await ws.commit("nm", "kp(nm): work");
  const tree = await simpleGit(repo).raw(["ls-tree", "-r", "kp/nm", "--name-only"]);
  expect(tree).toContain("real.txt");
  expect(tree).not.toContain("node_modules");
  await ws.rollback("nm");
});

test("acquire gives an isolated worktree with its own branch", async () => {
  const ws = new Workspace(repo);
  const flow = await ws.acquire("s1");
  expect(flow.branch).toBe("kp/s1");
  writeFileSync(join(flow.path, "new.txt"), "hi");
  // 主仓库看不到这个文件
  expect(existsSync(join(repo, "new.txt"))).toBe(false);
  await ws.release(flow.id);
});

test("acquire(flowId, base) forks the worktree from the given base branch", async () => {
  const g = simpleGit(repo);
  const def = (await g.branchLocal()).current;
  await g.checkoutLocalBranch("base-x");
  writeFileSync(join(repo, "onbase.txt"), "x\n"); await g.add("."); await g.commit("on base");
  await g.checkout(def);
  const ws = new Workspace(repo);
  const flow = await ws.acquire("f-base", "base-x");
  // worktree 从 base-x 分叉 → onbase.txt 在工作树里（off HEAD 则不会有）
  expect(existsSync(join(flow.path, "onbase.txt"))).toBe(true);
  await ws.rollback("f-base");
});

test("single-writer: second acquire on same flow id is rejected", async () => {
  const ws = new Workspace(repo);
  await ws.acquire("s1");
  await expect(ws.acquire("s1")).rejects.toThrow(/already held/);
});

test("rollback discards worktree changes cleanly", async () => {
  const ws = new Workspace(repo);
  const flow = await ws.acquire("s1");
  writeFileSync(join(flow.path, "dirty.txt"), "x");
  await ws.rollback(flow.id);
  const branches = await simpleGit(repo).branchLocal();
  expect(branches.all).not.toContain("kp/s1");
});

test("single-writer holds ACROSS processes (second Workspace instance is rejected by fs lock)", async () => {
  const wsA = new Workspace(repo);   // 进程 A
  const wsB = new Workspace(repo);   // 进程 B（独立内存 Map，模拟另一个进程）
  await wsA.acquire("s1");
  await expect(wsB.acquire("s1")).rejects.toThrow(/already held/);  // 文件锁拦住跨进程并发
  await wsA.rollback("s1");  // rollback 清掉 worktree+分支+锁（release 会保留分支留作人工合并）
  // A 回滚后，B 能拿到了
  const flow = await wsB.acquire("s1");
  expect(flow.branch).toBe("kp/s1");
  await wsB.rollback("s1");
});
