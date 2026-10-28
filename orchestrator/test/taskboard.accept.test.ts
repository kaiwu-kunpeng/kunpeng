import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskBoard } from "../src/taskboard/store.js";

async function mkBoard() {
  let n = 0;
  return new TaskBoard(await mkdtemp(join(tmpdir(), "kp-tb-")), () => ++n);
}

describe("TaskBoard(作者验收)", () => {
  it("create 自增 id + list", async () => {
    const b = await mkBoard();
    const a = await b.create({ subject: "甲", createdBy: "u" });
    const c = await b.create({ subject: "乙", createdBy: "u" });
    expect(Number(c.id)).toBeGreaterThan(Number(a.id));
    expect((await b.list()).length).toBe(2);
    expect(a.status).toBe("pending");
  });
  it("依赖阻塞:blockedBy 未终态不可认领,解锁后可认领", async () => {
    const b = await mkBoard();
    const dep = await b.create({ subject: "前置", createdBy: "u" });
    const t = await b.create({ subject: "后置", blockedBy: [dep.id], createdBy: "u" });
    await expect(b.claim(t.id, "w1")).rejects.toThrow(/阻塞/);
    await b.complete(dep.id);
    const claimed = await b.claim(t.id, "w1");
    expect(claimed.status).toBe("in_progress");
    expect(claimed.owner).toBe("w1");
  });
  it("重复认领:第二次认领已 in_progress 任务失败", async () => {
    const b = await mkBoard();
    const t = await b.create({ subject: "x", createdBy: "u" });
    await b.claim(t.id, "w1");
    await expect(b.claim(t.id, "w2")).rejects.toThrow();
  });
  it("claimNext 取最小 id 可认领任务", async () => {
    const b = await mkBoard();
    const t1 = await b.create({ subject: "1", createdBy: "u" });
    await b.create({ subject: "2", createdBy: "u" });
    const next = await b.claimNext("w");
    expect(next?.id).toBe(t1.id);
  });
  it("deleted 也解锁下游", async () => {
    const b = await mkBoard();
    const dep = await b.create({ subject: "d", createdBy: "u" });
    const t = await b.create({ subject: "t", blockedBy: [dep.id], createdBy: "u" });
    await b.cancel(dep.id);
    const claimed = await b.claim(t.id, "w");
    expect(claimed.status).toBe("in_progress");
  });
});