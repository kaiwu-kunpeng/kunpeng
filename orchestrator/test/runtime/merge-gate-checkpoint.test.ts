import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import simpleGit from "simple-git";
import { mergeAndClearGate } from "../../src/runtime/merge-gate.js";

describe("mergeAndClearGate 打断检查点", () => {
  let dir: string;
  let base: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mgc-"));
    const g = simpleGit(dir);
    await g.init();
    await g.addConfig("user.email", "t@t.com");
    await g.addConfig("user.name", "t");
    await writeFile(join(dir, "a.txt"), "v1\n");
    await g.add(".");
    await g.commit("init");
    base = (await g.branchLocal()).current;
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("onCheckpoint 返回 true 时不合并、返回失败、base HEAD 不动", async () => {
    const g = simpleGit(dir);
    const before = (await g.revparse(["HEAD"])).trim();
    const r = await mergeAndClearGate(dir, "someflow", base, { onCheckpoint: async () => true });
    expect(r.ok).toBe(false);
    expect(r.error ?? "").toMatch(/停止信号/);
    const after = (await g.revparse(["HEAD"])).trim();
    expect(after).toBe(before);
  });

  it("onCheckpoint 返回 false 时照常走（空 flowId 仍按既有校验失败，证明没被 checkpoint 短路）", async () => {
    const r = await mergeAndClearGate(dir, "   ", base, { onCheckpoint: async () => false });
    expect(r.ok).toBe(false);
    expect(r.error ?? "").not.toMatch(/停止信号/);
  });
});