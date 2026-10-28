import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleTaskCreate, handleTaskList } from "../../src/server/task-api.js";
import { readTask } from "../../src/task/store.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kp-taskapi-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const good = { type: "feature", title: "任务创建器", goal: "把启动新工作换成结构化表单", acceptanceCriteria: ["表单必填校验生效"], projectId: "kunpeng" };

describe("handleTaskCreate", () => {
  it("合格草稿建任务并落盘", async () => {
    const res = await handleTaskCreate(good, root);
    expect(res.status).toBe(200);
    const id = (res.body as { task: { id: string } }).task.id;
    expect((await readTask(root, id))?.status).toBe("draft");
  });
  it("不合格草稿返回 400 并列出问题", async () => {
    const res = await handleTaskCreate({ ...good, acceptanceCriteria: [] }, root);
    expect(res.status).toBe(400);
    expect((res.body as { problems: string[] }).problems.length).toBeGreaterThan(0);
  });
  it("非对象 payload 返回 400", async () => {
    const res = await handleTaskCreate("nonsense", root);
    expect(res.status).toBe(400);
  });
});

describe("handleTaskList", () => {
  it("返回已建任务", async () => {
    await handleTaskCreate(good, root);
    const res = await handleTaskList(root);
    expect(res.status).toBe(200);
    expect((res.body as { tasks: unknown[] }).tasks).toHaveLength(1);
  });
});