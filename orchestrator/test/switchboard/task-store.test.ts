import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "../../src/switchboard/task-store.js";

let dir: string;
let ts: TaskStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kp-taskstore-"));
  ts = new TaskStore(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("TaskStore 任务生命周期(真文件往返)", () => {
  it("createTask → submitted, createdBy=发起者, 可回查", async () => {
    const t = await ts.createTask({ from: "main", to: "all", body: "做个任务" });
    expect(t.status.state).toBe("submitted");
    expect(t.createdBy).toBe("main");
    expect(t.history).toHaveLength(1);
    const got = await ts.getTask(t.id);
    expect(got?.id).toBe(t.id);
  });

  it("sendToTask 追加 → working, 响应者 role=agent, history 时间序", async () => {
    const t = await ts.createTask({ from: "main", to: "design-loop", body: "做个任务" });
    await ts.sendToTask(t.id, { from: "design-loop", to: "main", body: "在做了" });
    const got = await ts.getTask(t.id);
    expect(got?.status.state).toBe("working");
    expect(got?.history).toHaveLength(2);
    expect(got?.history[0].role).toBe("user");
    expect(got?.history[1].role).toBe("agent");
  });

  it("cancelTask → canceled", async () => {
    const t = await ts.createTask({ from: "main", to: "design-loop", body: "做个任务" });
    await ts.cancelTask(t.id, { from: "main", to: "design-loop", reason: "不做了" });
    const got = await ts.getTask(t.id);
    expect(got?.status.state).toBe("canceled");
  });

  it("listTasks 只列 kind:task 的开启消息, 不混入普通回复消息", async () => {
    const a = await ts.createTask({ from: "main", to: "all", body: "任务A" });
    await ts.sendToTask(a.id, { from: "x", to: "main", body: "这是回复不是任务开启" });
    const list = await ts.listTasks();
    expect(list.map((t) => t.id)).toEqual([a.id]);
  });

  it("getTask 未知 id 返回 null", async () => {
    expect(await ts.getTask("nope")).toBeNull();
  });
});
