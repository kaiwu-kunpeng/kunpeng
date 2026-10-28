import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { afterEach, describe, expect, it } from "vitest";
import { mergeAndClearGate } from "../src/runtime/merge-gate.js";

const cleanups: string[] = [];
afterEach(async () => { for (const d of cleanups.splice(0)) await rm(d, { recursive: true, force: true }).catch(() => {}); });

async function seedRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kp-mgpush-"));
  cleanups.push(dir);
  const g = simpleGit(dir);
  await g.init(["-b", "main"]);
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  await g.raw(["commit", "--allow-empty", "-m", "base"]);
  await g.checkoutLocalBranch("kp/flow-x");
  await g.raw(["commit", "--allow-empty", "-m", "work"]);
  await g.checkout("main");
  return dir;
}

describe("合并主链路 push", () => {
  it("push 失败时合并仍成功(ok=true),note 提示 push 失败,本地 main 已含该流提交", async () => {
    const dir = await seedRepo();
    await simpleGit(dir).addRemote("origin", join(dir, "no-such-remote.git"));
    const res = await mergeAndClearGate(dir, "flow-x", "main", { stopCheckpoint: false, review: async () => ({ block: false }) });
    expect(res.ok).toBe(true);
    expect(res.note ?? "").toContain("push");
    const log = await simpleGit(dir).raw(["log", "--oneline", "main"]);
    expect(log).toContain("work");
  });

  it("无 origin 的本地仓:合并成功且不因缺 remote 报错", async () => {
    const dir = await seedRepo();
    const res = await mergeAndClearGate(dir, "flow-x", "main", { stopCheckpoint: false, review: async () => ({ block: false }) });
    expect(res.ok).toBe(true);
    const log = await simpleGit(dir).raw(["log", "--oneline", "main"]);
    expect(log).toContain("work");
  });
});