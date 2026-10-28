import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskBoard } from "../src/taskboard/store.js";
import { deadOwners, tasksToReclaim, reapDeadTasks } from "../src/taskboard/reaper.js";

describe("心跳判死回收(作者验收)", () => {
  it("deadOwners:无心跳或陈旧判死,新鲜存活", () => {
    const hb = [{ instance: "alive", ts: 1000 }, { instance: "stale", ts: 100 }];
    const dead = deadOwners(hb, ["alive", "stale", "ghost"], 1000, 500);
    expect(dead).not.toContain("alive");
    expect(dead).toContain("stale");
    expect(dead).toContain("ghost");
  });
  it("tasksToReclaim 只选死主的 in_progress", async () => {
    const b = new TaskBoard(await mkdtemp(join(tmpdir(), "kp-rp-")), (() => { let n = 0; return () => ++n; })());
    const t1 = await b.create({ subject: "1", createdBy: "u" });
    const t2 = await b.create({ subject: "2", createdBy: "u" });
    await b.claim(t1.id, "dead"); await b.claim(t2.id, "alive");
    const ids = tasksToReclaim(await b.list(), [{ instance: "alive", ts: 9999 }], 9999, 500);
    expect(ids).toContain(t1.id);
    expect(ids).not.toContain(t2.id);
  });
  it("reapDeadTasks 把死主任务置回 pending 可被再认领", async () => {
    const b = new TaskBoard(await mkdtemp(join(tmpdir(), "kp-rp2-")), (() => { let n = 0; return () => ++n; })());
    const t = await b.create({ subject: "x", createdBy: "u" });
    await b.claim(t.id, "dead");
    const presence = { list: async () => [] as { instance: string; ts: number }[] };
    const released = await reapDeadTasks(b, presence, 999999, 500);
    expect(released).toContain(t.id);
    const after = await b.get(t.id);
    expect(after?.status).toBe("pending");
    expect(after?.owner).toBeNull();
    // 释放后可被新 worker 认领
    expect((await b.claim(t.id, "w2")).owner).toBe("w2");
  });
});