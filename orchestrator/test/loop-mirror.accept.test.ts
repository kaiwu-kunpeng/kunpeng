import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskBoard } from "../src/taskboard/store.js";
import { makeTaskBoardMirror, noopMirror } from "../src/taskboard/loop-mirror.js";

async function mkBoard() {
  let n = 0;
  return new TaskBoard(await mkdtemp(join(tmpdir(), "kp-mir-")), () => ++n);
}

describe("loop 镜像(作者验收)", () => {
  it("onStart 建+认领任务,onEnd verified 完成", async () => {
    const board = await mkBoard();
    const m = makeTaskBoardMirror(board, "inst-1");
    await m.onStart("flow-a", "实现 A");
    const running = (await board.list()).find((t) => t.status === "in_progress");
    expect(running).toBeTruthy();
    expect(running?.owner).toBe("inst-1");
    await m.onEnd("flow-a", true);
    const done = (await board.list()).find((t) => t.description.includes("flow-a") || t.subject.includes("flow-a") || t.subject.includes("实现 A"));
    expect(done?.status).toBe("completed");
  });
  it("onEnd 失败 → 任务回 pending 可再认领", async () => {
    const board = await mkBoard();
    const m = makeTaskBoardMirror(board, "inst-1");
    await m.onStart("flow-b", "实现 B");
    await m.onEnd("flow-b", false);
    const t = (await board.list())[0]!;
    expect(t.status).toBe("pending");
    expect(t.owner).toBeNull();
  });
  it("noop 镜像不建任何任务", async () => {
    const board = await mkBoard();
    const m = noopMirror();
    await m.onStart("x", "y");
    await m.onEnd("x", true);
    expect((await board.list()).length).toBe(0);
  });
  it("镜像吞错:未知 flowId onEnd 不抛", async () => {
    const board = await mkBoard();
    const m = makeTaskBoardMirror(board, "inst");
    await expect(m.onEnd("never-started", true)).resolves.toBeUndefined();
  });
});