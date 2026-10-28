import { randomUUID } from "node:crypto";
import { createTask, listTasks, transitionTask } from "../task/store.js";
import { validateTaskDraft, type TaskDraft } from "../task/templates.js";
import type { Task, TaskStatus } from "../task/model.js";

const SAFE_TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface TaskApiResult {
  status: number;
  body: unknown;
}

export async function handleTaskCreate(body: unknown, root: string): Promise<TaskApiResult> {
  if (!isPlainObject(body)) {
    return { status: 400, body: { problems: ["payload must be an object"] } };
  }

  const draft: TaskDraft = body;
  const validation = validateTaskDraft(draft);
  if (!validation.ok) {
    return { status: 400, body: { problems: validation.problems } };
  }

  const now = new Date().toISOString();
  const task: Task = {
    ...draft,
    id: `task-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
    title: String(draft.title ?? ""),
    type: String(draft.type),
    projectId: String(draft.projectId ?? ""),
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };

  try {
    const created = await createTask(root, task);
    return { status: 200, body: { task: created } };
  } catch (error) {
    return { status: 400, body: { problems: [String((error as Error).message ?? error)] } };
  }
}

export async function handleTaskList(root: string): Promise<TaskApiResult> {
  return { status: 200, body: { tasks: await listTasks(root) } };
}

export async function handleTaskTransition(body: unknown, root: string): Promise<TaskApiResult> {
  if (!isPlainObject(body)) {
    return { status: 400, body: { ok: false, error: "payload must be an object" } };
  }

  const id = body.id;
  const to = body.to;
  if (typeof id !== "string" || typeof to !== "string") {
    return { status: 400, body: { ok: false, error: "id and to must be strings" } };
  }
  if (!SAFE_TASK_ID.test(id) || id.includes("..")) {
    return { status: 400, body: { ok: false, error: "非法任务 id" } };
  }

  try {
    const task = await transitionTask(root, id, to as TaskStatus);
    return { status: 200, body: { ok: true, task } };
  } catch (error) {
    return { status: 400, body: { ok: false, error: String((error as Error).message ?? error) } };
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
