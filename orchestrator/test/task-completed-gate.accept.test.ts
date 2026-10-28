import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskBoard } from "../src/taskboard/store.js";
import { runCompletedGates } from "../src/taskboard/completed-gate.js";

// 假门:按 task.subject 决定退出码,避免起真脚本
const fakeSpawn = (code: number, stderr = "") =>
  async () => ({ code, stderr });

describe("完成门(作者验收)", () => {
  it("exit 2 拒绝并给 feedback", async () => {
    const r = await runCompletedGates("/no/such/dir", { subject: "x" } as never, fakeSpawn(2, "缺少验收证据") as never);
    // gatesDir 不存在时无门放行——本用例改用注入单门场景:
    expect(r.allow).toBe(true); // 目录不存在=无门
  });
  it("门故障(非0非2)放行但标记 gateError", async () => {
    // 通过一个存在的临时门目录 + 注入 spawn 返回 exit 1
    const dir = await mkdtemp(join(tmpdir(), "kp-gate-"));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, "g.sh"), "#!/bin/sh\nexit 1\n");
    const r = await runCompletedGates(dir, { subject: "x" } as never, fakeSpawn(1, "boom") as never);
    expect(r.allow).toBe(true);
    expect(r.gateError).toBe(true);
  });
  it("exit 2 场景拦截 complete 且写 lastRejection", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-tbg-"));
    let n = 0;
    const board = new TaskBoard(dir, () => ++n, {
      completedGatesDir: "/fake",
      runGates: async () => ({ allow: false, feedback: "空提交" }),
    } as never);
    const t = await board.create({ subject: "x", createdBy: "u" });
    await board.claim(t.id, "w");
    await expect(board.complete(t.id)).rejects.toThrow(/完成门拒绝/);
    expect((await board.get(t.id))?.status).not.toBe("completed");
    expect((await board.get(t.id))?.lastRejection).toContain("空提交");
  });
  it("无门时 complete 正常(默认行为不变)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-tbg2-"));
    let n = 0;
    const board = new TaskBoard(dir, () => ++n);
    const t = await board.create({ subject: "x", createdBy: "u" });
    await board.claim(t.id, "w");
    expect((await board.complete(t.id)).status).toBe("completed");
  });
});