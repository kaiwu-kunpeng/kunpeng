import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTaskBatchForBuild } from "../../src/product/build-tasks.js";
import { listTasks } from "../../src/task/store.js";
import { readLoopState, writeLoopState } from "../../src/product/loop-store.js";
import { initState } from "../../src/product/stage-machine.js";

const NOW = 1_800_000_000_000;
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kp-buildtasks-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const def = { stories: ["用户能一句话新建产品", "构建后能看到任务批"] };

describe("createTaskBatchForBuild", () => {
  it("每个 story 落一条 ready 任务并回写产品状态", async () => {
    await writeLoopState(root, initState("demo-prod", "演示产品", NOW));
    const ids = await createTaskBatchForBuild(root, "demo-prod", "演示产品", def, NOW);
    expect(ids).toHaveLength(2);
    const tasks = await listTasks(root);
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.status === "ready")).toBe(true);
    expect(tasks.every((t) => t.projectId === "demo-prod")).toBe(true);
    const st = await readLoopState(root, "demo-prod");
    expect(st?.buildTasks?.ids?.slice().sort()).toEqual(ids.slice().sort());
    expect(st?.buildTasks?.createdAt).toBe(NOW);
  });
  it("空 stories 返回空且不落盘", async () => {
    const ids = await createTaskBatchForBuild(root, "empty-prod", "空产品", { stories: [] }, NOW);
    expect(ids).toEqual([]);
    expect(await listTasks(root)).toHaveLength(0);
  });
  it("无产品状态时任务照落、不抛错", async () => {
    const ids = await createTaskBatchForBuild(root, "no-state", "无状态产品", def, NOW);
    expect(ids).toHaveLength(2);
    expect(await listTasks(root)).toHaveLength(2);
  });
});