import * as fs from "node:fs/promises";
import { join } from "node:path";
import { withDirLock } from "../taskboard/lock.js";
import { writeFileAtomic } from "../util/atomic-write.js";
import { canTransition, TaskSchema, type Task, type TaskStatus } from "./model.js";
import { hasErrnoCode } from "../util/errors.js";

type FileSystem = Pick<typeof fs, "access" | "readFile">;

const TASKS_DIR = ".kunpeng/tasks";
const SAFE_TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assertSafeTaskId(id: string): void {
  if (!SAFE_TASK_ID.test(id) || id.includes("..")) {
    throw new Error("非法任务 id");
  }
}

function tasksDir(root: string): string {
  return join(root, TASKS_DIR);
}

function taskPath(root: string, id: string): string {
  assertSafeTaskId(id);
  return join(tasksDir(root), `${id}.json`);
}

async function exists(path: string, io: FileSystem = fs): Promise<boolean> {
  try {
    await io.access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeTask(path: string, task: Task): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(task, null, 2)}\n`);
}

async function readPath(path: string, io: FileSystem = fs): Promise<Task | null> {
  try {
    const raw: unknown = JSON.parse(await io.readFile(path, "utf8"));
    return TaskSchema.parse(raw);
  } catch (error) {
    if (!hasErrnoCode(error, "ENOENT")) {
      console.warn(`[task] 任务档损坏,已跳过: ${path}: ${String(error)}`);
    }
    return null;
  }
}

export async function createTask(root: string, task: unknown): Promise<Task> {
  const parsed = TaskSchema.parse(task);
  assertSafeTaskId(parsed.id);
  return withDirLock(tasksDir(root), async () => {
    const path = taskPath(root, parsed.id);
    if (await exists(path)) {
      throw new Error(`task already exists: ${parsed.id}`);
    }
    await writeTask(path, parsed);
    return parsed;
  });
}

export async function readTask(root: string, id: string): Promise<Task | null> {
  return readPath(taskPath(root, id));
}

export async function listTasks(root: string): Promise<Task[]> {
  let files: string[];
  try {
    files = await fs.readdir(tasksDir(root));
  } catch {
    return [];
  }

  const tasks = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => readPath(join(tasksDir(root), file))),
  );
  return tasks.filter((task): task is Task => task !== null);
}

export async function transitionTask(root: string, id: string, to: TaskStatus): Promise<Task> {
  assertSafeTaskId(id);
  return withDirLock(tasksDir(root), async () => {
    const current = await readTask(root, id);
    if (!current) throw new Error(`task not found: ${id}`);
    if (!canTransition(current.status, to)) {
      throw new Error(`invalid task transition: ${current.status} -> ${to}`);
    }

    const updated = TaskSchema.parse({
      ...current,
      status: to,
      updatedAt: new Date().toISOString(),
    });
    await writeTask(taskPath(root, id), updated);
    return updated;
  });
}
