import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { snapshotCheckpoint, listCheckpoints, restoreCheckpoint } from "../../src/runtime/flow-checkpoint.js";

async function repoWithFlow() {
  const repo = mkdtempSync(join(tmpdir(), "kp-ckpt-"));
  const git = simpleGit(repo);
  await git.init();
  await git.addConfig("user.email", "t@t.t");
  await git.addConfig("user.name", "t");
  writeFileSync(join(repo, "f.txt"), "0\n");
  await git.add(".");
  await git.commit("init");
  await git.branch(["-M", "main"]).catch(() => {});
  await git.checkoutLocalBranch("kp/flowX");
  writeFileSync(join(repo, "f.txt"), "A\n");
  await git.add(".");
  await git.commit("A");
  return { repo, git };
}

describe("flow-checkpoint 引擎", () => {
  it("snapshot → list → restore 全链路", async () => {
    const { repo, git } = await repoWithFlow();
    try {
      const shaA = (await git.revparse(["kp/flowX"])).trim();
      const snap = await snapshotCheckpoint(repo, "flowX", "implement");
      expect(snap.ok).toBe(true);
      expect(snap.sha).toBe(shaA);
      // 分支再前进一个提交
      writeFileSync(join(repo, "f.txt"), "B\n");
      await git.add(".");
      await git.commit("B");
      const shaB = (await git.revparse(["kp/flowX"])).trim();
      expect(shaB).not.toBe(shaA);
      // list 含 implement 且指向 A
      const cks = await listCheckpoints(repo, "flowX");
      const ck = cks.find((c) => c.stage === "implement");
      expect(ck).toBeTruthy();
      expect(ck!.sha).toBe(shaA);
      // restore 回到 A
      const res = await restoreCheckpoint(repo, "flowX", "implement");
      expect(res.ok).toBe(true);
      expect((await git.revparse(["kp/flowX"])).trim()).toBe(shaA);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  }, 30000);

  it("分支不存在→snapshot ok:false;标签不存在→restore ok:false", async () => {
    const repo = mkdtempSync(join(tmpdir(), "kp-ckpt2-"));
    const git = simpleGit(repo);
    await git.init();
    await git.addConfig("user.email", "t@t.t");
    await git.addConfig("user.name", "t");
    writeFileSync(join(repo, "f.txt"), "0\n");
    await git.add(".");
    await git.commit("init");
    try {
      expect((await snapshotCheckpoint(repo, "nope", "implement")).ok).toBe(false);
      expect((await restoreCheckpoint(repo, "nope", "implement")).ok).toBe(false);
      expect(await listCheckpoints(repo, "nope")).toEqual([]);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  }, 30000);
});
