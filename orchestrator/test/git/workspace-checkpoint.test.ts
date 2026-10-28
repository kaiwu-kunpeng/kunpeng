import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import { afterEach, beforeEach, expect, test } from "vitest";
import { Workspace } from "../../src/git/workspace.js";
import { listCheckpoints } from "../../src/runtime/flow-checkpoint.js";

let repo: string;
let g: SimpleGit;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-wt-ckpt-"));
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

test("checkpoint 提交 worktree 并打 tag,内容可恢复", async () => {
  const ws = new Workspace(repo);
  const flow = await ws.acquire("f1", "main");
  // 模拟 implement 在 worktree 写代码
  writeFileSync(join(flow.path, "impl.txt"), "implemented\n");

  const r = await ws.checkpoint("f1", "implement");
  expect(r.ok).toBe(true);
  expect(typeof r.sha).toBe("string");

  // checkpoint 已登记
  const cps = await listCheckpoints(repo, "f1");
  expect(cps.map((c) => c.stage)).toContain("implement");
  const cp = cps.find((c) => c.stage === "implement");
  expect(cp!.sha).toBe(r.sha);

  // tag 指向的提交树里有 implement 写的文件(从主仓读 tag,不依赖 worktree 存活)
  const shown = await g.show(["kp-ckpt/f1/implement:impl.txt"]);
  expect(shown).toContain("implemented");
});

test("未持有的 flow checkpoint 返回 ok:false 不抛", async () => {
  const ws = new Workspace(repo);
  const r = await ws.checkpoint("never-acquired", "implement");
  expect(r.ok).toBe(false);
});