import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nextStatuses } from "../../src/task/model.js";
import { createTask, readTask } from "../../src/task/store.js";
import { handleTaskTransition } from "../../src/server/task-api.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kp-trans-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

async function mkTask(): Promise<string> {
  const t = await createTask(root, { title: "任务A", type: "feature", goal: "g", acceptance: ["a"] });
  return t.id;
}

describe("nextStatuses", () => {
  it("draft 只能去 ready", () => {
    expect(nextStatuses("draft")).toEqual(["ready"]);
  });
  it("running 可去 verifying / blocked，顺序按 TASK_STATUSES", () => {
    expect(nextStatuses("running")).toEqual(["verifying", "blocked"]);
  });
  it("archived 与未知态返回空", () => {
    expect(nextStatuses("archived")).toEqual([]);
    expect(nextStatuses("nonsense")).toEqual([]);
  });
});

describe("handleTaskTransition", () => {
  it("合法流转成功并真落盘", async () => {
    const id = await mkTask();
    const r = await handleTaskTransition({ id, to: "ready" }, root);
    expect(r.status).toBe(200);
    expect((r.body as { ok: boolean }).ok).toBe(true);
    expect((await readTask(root, id))?.status).toBe("ready");
  });
  it("非法流转 400 且状态不变", async () => {
    const id = await mkTask();
    const r = await handleTaskTransition({ id, to: "delivered" }, root);
    expect(r.status).toBe(400);
    expect((await readTask(root, id))?.status).toBe("draft");
  });
  it("任务不存在 400", async () => {
    const r = await handleTaskTransition({ id: "ghost", to: "ready" }, root);
    expect(r.status).toBe(400);
  });
  it("缺参 400", async () => {
    const r = await handleTaskTransition({ id: "x" }, root);
    expect(r.status).toBe(400);
  });
});