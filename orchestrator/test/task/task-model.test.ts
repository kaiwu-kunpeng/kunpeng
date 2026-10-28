import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskSchema, canTransition, TASK_STATUSES } from "../../src/task/model.js";
import { createTask, readTask, listTasks, transitionTask } from "../../src/task/store.js";

const baseTask = {
  id: "t1", title: "修复登录页报错", type: "bug-fix", projectId: "kunpeng",
  status: "draft", createdAt: "2026-07-02T00:00:00Z", updatedAt: "2026-07-02T00:00:00Z",
};

describe("TaskSchema", () => {
  it("合法任务通过校验", () => {
    expect(TaskSchema.parse(baseTask).id).toBe("t1");
  });
  it("非法 status 被拒绝", () => {
    expect(() => TaskSchema.parse({ ...baseTask, status: "nope" })).toThrow();
  });
  it("缺 title 被拒绝", () => {
    const { title: _drop, ...rest } = baseTask;
    expect(() => TaskSchema.parse(rest)).toThrow();
  });
});

describe("canTransition", () => {
  it("主链合法流转", () => {
    expect(canTransition("draft", "ready")).toBe(true);
    expect(canTransition("ready", "running")).toBe(true);
    expect(canTransition("running", "verifying")).toBe(true);
    expect(canTransition("verifying", "needs-review")).toBe(true);
    expect(canTransition("needs-review", "delivered")).toBe(true);
    expect(canTransition("delivered", "archived")).toBe(true);
  });
  it("阻塞与恢复", () => {
    expect(canTransition("running", "blocked")).toBe(true);
    expect(canTransition("blocked", "ready")).toBe(true);
  });
  it("非法流转被拒", () => {
    expect(canTransition("draft", "delivered")).toBe(false);
    expect(canTransition("delivered", "running")).toBe(false);
  });
  it("状态集完整", () => {
    for (const s of ["draft", "ready", "running", "verifying", "needs-review", "delivered", "blocked", "archived"]) {
      expect(TASK_STATUSES).toContain(s);
    }
  });
});

describe("task store", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kp-task-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("create/read 往返", async () => {
    await createTask(root, baseTask);
    expect((await readTask(root, "t1"))?.title).toBe("修复登录页报错");
  });
  it("list 返回已建任务", async () => {
    await createTask(root, baseTask);
    await createTask(root, { ...baseTask, id: "t2" });
    expect((await listTasks(root)).map((t) => t.id).sort()).toEqual(["t1", "t2"]);
  });
  it("transition 守卫非法流转", async () => {
    await createTask(root, baseTask);
    await transitionTask(root, "t1", "ready");
    expect((await readTask(root, "t1"))?.status).toBe("ready");
    await expect(transitionTask(root, "t1", "delivered")).rejects.toThrow();
  });
});