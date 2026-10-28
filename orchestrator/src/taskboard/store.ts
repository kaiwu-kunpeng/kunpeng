import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../util/atomic-write.js";
import { runCompletedGates } from "./completed-gate.js";
import { withDirLock } from "./lock.js";
import { hasErrnoCode } from "../util/errors.js";

export interface Task {
  id: string;
  subject: string;
  description: string;
  owner: string | null;
  status: "pending" | "in_progress" | "completed" | "deleted";
  blocks: string[];
  blockedBy: string[];
  projectId?: string;
  flowId?: string;
  createdBy: string;
  createdAt: number;
  claimedAt?: number;
  reclaimedAt?: number;
  reclaimCount?: number;
  completedAt?: number;
  lastRejection?: string;
  lastGateWarning?: string;
}

export interface CreateTaskInput {
  subject: string;
  description?: string;
  blockedBy?: string[];
  projectId?: string;
  createdBy: string;
}

const TERMINAL_STATUSES = new Set<Task["status"]>(["completed", "deleted"]);
const TASK_STATUSES = new Set<Task["status"]>(["pending", "in_progress", "completed", "deleted"]);

function validId(id: string): boolean {
  return /^[1-9]\d*$/.test(id);
}

function parseTask(value: unknown): Task | null {
  if (typeof value !== "object" || value === null) return null;
  const task = value as Partial<Task>;
  if (
    typeof task.id !== "string"
    || !validId(task.id)
    || typeof task.subject !== "string"
    || typeof task.description !== "string"
    || !(task.owner === null || typeof task.owner === "string")
    || !TASK_STATUSES.has(task.status as Task["status"])
    || !Array.isArray(task.blocks)
    || !task.blocks.every((id) => typeof id === "string")
    || !Array.isArray(task.blockedBy)
    || !task.blockedBy.every((id) => typeof id === "string")
    || typeof task.createdBy !== "string"
    || typeof task.createdAt !== "number"
    || !(task.reclaimedAt === undefined || typeof task.reclaimedAt === "number")
    || !(task.reclaimCount === undefined || typeof task.reclaimCount === "number")
    || !(task.lastRejection === undefined || typeof task.lastRejection === "string")
    || !(task.lastGateWarning === undefined || typeof task.lastGateWarning === "string")
  ) {
    return null;
  }
  return task as Task;
}

export class TaskBoard {
  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now,
    private readonly options: {
      completedGatesDir?: string;
      runGates?: typeof runCompletedGates;
    } = {},
  ) {}

  private path(id: string): string {
    if (!validId(id)) throw new Error(`无效任务 ID: ${id}`);
    return join(this.dir, `${id}.json`);
  }

  private async read(id: string): Promise<Task | null> {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.path(id), "utf8")) as unknown;
    } catch (error) {
      if (hasErrnoCode(error, "ENOENT")) return null;
      if (error instanceof SyntaxError) {
        console.warn(`[taskboard] 任务档损坏(JSON 解析失败),已按不存在处理: ${id}`);
        return null;
      }
      throw error;
    }
    const task = parseTask(raw);
    if (!task) console.warn(`[taskboard] 任务档字段非法,已按不存在处理: ${id}`);
    return task;
  }

  private async require(id: string): Promise<Task> {
    const task = await this.read(id);
    if (!task) throw new Error(`任务不存在或数据损坏: ${id}`);
    return task;
  }

  private async write(task: Task): Promise<void> {
    await writeFileAtomic(this.path(task.id), `${JSON.stringify(task, null, 2)}\n`);
  }

  private async dependenciesComplete(task: Task): Promise<boolean> {
    for (const dependencyId of task.blockedBy) {
      const dependency = await this.read(dependencyId);
      if (!dependency || !TERMINAL_STATUSES.has(dependency.status)) return false;
    }
    return true;
  }

  private async listUnlocked(): Promise<Task[]> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch (error) {
      if (hasErrnoCode(error, "ENOENT")) return [];
      throw error;
    }
    const tasks = await Promise.all(
      files
        .filter((file) => /^[1-9]\d*\.json$/.test(file))
        .map((file) => this.read(file.slice(0, -5))),
    );
    return tasks
      .filter((task): task is Task => task !== null)
      .sort((a, b) => Number(a.id) - Number(b.id));
  }

  async create(input: CreateTaskInput): Promise<Task> {
    return withDirLock(this.dir, async () => {
      const watermarkPath = join(this.dir, ".highwatermark");
      let watermark = 0;
      try {
        const raw = (await readFile(watermarkPath, "utf8")).trim();
        watermark = Number(raw);
        if (!Number.isSafeInteger(watermark) || watermark < 0) {
          throw new Error(`任务高水位损坏: ${raw}`);
        }
      } catch (error) {
        if (!hasErrnoCode(error, "ENOENT")) throw error;
      }
      if (watermark >= Number.MAX_SAFE_INTEGER) throw new Error("任务 ID 已耗尽");

      const id = String(watermark + 1);
      const blockedBy = [...new Set(input.blockedBy ?? [])];
      for (const dependencyId of blockedBy) {
        if (!validId(dependencyId)) throw new Error(`无效依赖任务 ID: ${dependencyId}`);
      }
      const task: Task = {
        id,
        subject: input.subject,
        description: input.description ?? "",
        owner: null,
        status: "pending",
        blocks: [],
        blockedBy,
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        createdBy: input.createdBy,
        createdAt: this.now(),
      };

      await writeFileAtomic(watermarkPath, `${id}\n`);
      await this.write(task);
      for (const dependencyId of blockedBy) {
        const dependency = await this.read(dependencyId);
        if (dependency && !dependency.blocks.includes(id)) {
          await this.write({ ...dependency, blocks: [...dependency.blocks, id] });
        }
      }
      return task;
    });
  }

  async claim(id: string, owner: string): Promise<Task> {
    return withDirLock(this.dir, async () => {
      const task = await this.require(id);
      if (task.status !== "pending") throw new Error(`任务非 pending: ${id}`);
      if (!(await this.dependenciesComplete(task))) throw new Error(`任务被阻塞: ${id}`);
      const claimed: Task = { ...task, owner, status: "in_progress", claimedAt: this.now() };
      await this.write(claimed);
      return claimed;
    });
  }

  async claimNext(owner: string): Promise<Task | null> {
    return withDirLock(this.dir, async () => {
      const tasks = await this.listUnlocked();
      for (const task of tasks) {
        if (task.status !== "pending" || !(await this.dependenciesComplete(task))) continue;
        const claimed: Task = { ...task, owner, status: "in_progress", claimedAt: this.now() };
        await this.write(claimed);
        return claimed;
      }
      return null;
    });
  }

  async reclaim(id: string): Promise<Task> {
    return withDirLock(this.dir, async () => {
      const task = await this.require(id);
      if (task.status !== "in_progress") throw new Error(`任务非 in_progress: ${id}`);
      const { claimedAt: _claimedAt, ...withoutClaimedAt } = task;
      const reclaimed: Task = {
        ...withoutClaimedAt,
        owner: null,
        status: "pending",
        reclaimedAt: this.now(),
        reclaimCount: (task.reclaimCount ?? 0) + 1,
      };
      await this.write(reclaimed);
      return reclaimed;
    });
  }

  async complete(id: string): Promise<Task> {
    return withDirLock(this.dir, async () => {
      const task = await this.require(id);
      let gateResult: Awaited<ReturnType<typeof runCompletedGates>> = { allow: true };
      if (this.options.completedGatesDir !== undefined) {
        const runGates = this.options.runGates ?? runCompletedGates;
        try {
          gateResult = await runGates(this.options.completedGatesDir, task);
        } catch {
          gateResult = {
            allow: true,
            gateError: true,
            feedback: "门脚本故障(exit error),放行但需关注",
          };
        }
      }
      if (!gateResult.allow) {
        const feedback = gateResult.feedback ?? "";
        await this.write({ ...task, lastRejection: feedback });
        throw new Error(`完成门拒绝: ${feedback}`);
      }
      const completed: Task = {
        ...task,
        status: "completed",
        completedAt: this.now(),
        ...(gateResult.gateError ? { lastGateWarning: gateResult.feedback ?? "" } : {}),
      };
      await this.write(completed);
      return completed;
    });
  }

  async cancel(id: string): Promise<Task> {
    return withDirLock(this.dir, async () => {
      const cancelled: Task = { ...await this.require(id), status: "deleted", completedAt: this.now() };
      await this.write(cancelled);
      return cancelled;
    });
  }

  async list(): Promise<Task[]> {
    return this.listUnlocked();
  }

  async get(id: string): Promise<Task | null> {
    return this.read(id);
  }
}
