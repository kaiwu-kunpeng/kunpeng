import { randomBytes } from "node:crypto";

import { SwitchboardStore, kindOf, newMessage } from "./store.js";
import { deriveTask, type Task } from "./task.js";

export interface TaskStoreDeps {
  now: () => number;
  id: () => string;
}

function defaultDeps(): TaskStoreDeps {
  let lastTs = 0;

  return {
    now: () => {
      const current = Date.now();
      lastTs = Math.max(current, lastTs + 1);
      return lastTs;
    },
    id: () => `task-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
  };
}

export class TaskStore {
  private store: SwitchboardStore;
  private deps: TaskStoreDeps;

  constructor(dir: string, deps: TaskStoreDeps = defaultDeps()) {
    this.store = new SwitchboardStore(dir);
    this.deps = deps;
  }

  async createTask(input: { from: string; to?: string; body: string }): Promise<Task> {
    const msg = newMessage(
      { from: input.from, to: input.to ?? "all", body: input.body, kind: "task" },
      this.deps,
    );
    await this.store.append(msg);

    const task = await this.getTask(msg.id);
    if (task === null) throw new Error("createTask: 任务建立后取回为空");
    return task;
  }

  async sendToTask(taskId: string, input: { from: string; to: string; body: string }): Promise<void> {
    const msg = newMessage({ from: input.from, to: input.to, topic: taskId, body: input.body }, this.deps);
    await this.store.append(msg);
  }

  async cancelTask(taskId: string, input: { from: string; to: string; reason?: string }): Promise<void> {
    const msg = newMessage(
      { from: input.from, to: input.to, topic: taskId, body: input.reason ?? "已取消", kind: "stop" },
      this.deps,
    );
    await this.store.append(msg);
  }

  async completeTask(taskId: string, input: { from: string; to: string; result?: string }): Promise<void> {
    const msg = newMessage(
      { from: input.from, to: input.to, topic: taskId, body: input.result ?? "已完成", kind: "receipt" },
      this.deps,
    );
    await this.store.append(msg);
  }

  async failTask(taskId: string, input: { from: string; to: string; reason?: string }): Promise<void> {
    const msg = newMessage(
      { from: input.from, to: input.to, topic: taskId, body: input.reason ?? "失败", kind: "failure" },
      this.deps,
    );
    await this.store.append(msg);
  }

  async getTask(taskId: string): Promise<Task | null> {
    return deriveTask(taskId, await this.store.list());
  }

  async listTasks(): Promise<Task[]> {
    const all = await this.store.list();
    const tasks: Task[] = [];

    for (const msg of all) {
      if (kindOf(msg) !== "task") continue;
      const task = deriveTask(msg.id, all);
      if (task !== null) tasks.push(task);
    }

    return tasks;
  }
}
