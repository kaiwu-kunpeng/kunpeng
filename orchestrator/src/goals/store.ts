import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { withFileLock } from "../runtime/filelock.js";
import { writeFileAtomic } from "../util/atomic-write.js";

export const GOAL_ID_RE = /^goal-[a-z0-9][a-z0-9-]{1,63}$/;
export const UNASSIGNED_GOAL_ID = "未归属";

export function isGoalId(s: unknown): s is string {
  return typeof s === "string" && GOAL_ID_RE.test(s);
}

export function goalBucket(flow: { goalId?: string }): string {
  return isGoalId(flow.goalId) ? flow.goalId : UNASSIGNED_GOAL_ID;
}

export interface GoalMetric {
  key: string;
  label: string;
  target: number;
  direction: "up" | "down";
  current?: number;
  updatedAt?: number;
}

export interface Goal {
  id: string;
  product: string;
  statement: string;
  owner: string;
  status: "active" | "done" | "paused";
  metric?: GoalMetric;
  budgetUsd?: number;
  windowStart: number;
  due?: number;
  createdAt: number;
  updatedAt: number;
  // 持久化创建序，避免同毫秒创建的目标在更新文件后重排。
  creationOrder?: number;
  history: { at: number; by: string; note: string }[];
}

type CreateGoalInput = Pick<Goal, "product" | "statement" | "metric" | "budgetUsd" | "due"> & {
  id?: string;
  owner?: string;
  by?: string;
};

const goalSchema = z.object({
  id: z.string().regex(GOAL_ID_RE),
  product: z.string(),
  statement: z.string(),
  owner: z.string(),
  status: z.enum(["active", "done", "paused"]),
  metric: z.object({
    key: z.string(), label: z.string(), target: z.number().finite(),
    direction: z.enum(["up", "down"]),
    current: z.number().finite().optional(), updatedAt: z.number().finite().optional(),
  }).optional(),
  budgetUsd: z.number().finite().optional(),
  windowStart: z.number().finite(),
  due: z.number().finite().optional(),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  creationOrder: z.number().int().positive().optional(),
  history: z.array(z.object({ at: z.number().finite(), by: z.string(), note: z.string() })),
});

export function goalsDir(kunpengDir: string): string {
  return join(kunpengDir, "goals");
}

export class GoalStore {
  private warned = new Set<string>();

  constructor(private dir: string, private now: () => number = Date.now) {}

  private path(id: string): string {
    if (!isGoalId(id)) throw new Error(`非法目标 id：${id}`);
    return join(this.dir, `${id}.json`);
  }

  private async readFile(path: string): Promise<Goal | null> {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    try {
      return goalSchema.parse(JSON.parse(text));
    } catch {
      if (!this.warned.has(path)) {
        this.warned.add(path);
        console.warn(`[goal] 目标文件损坏或形状不合法，已跳过：${path}`);
      }
      return null;
    }
  }

  async list(): Promise<Goal[]> {
    const entries = await readdir(this.dir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const goals: { goal: Goal; mtime: number }[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const path = join(this.dir, entry.name);
      const goal = await this.readFile(path);
      if (!goal) continue;
      try {
        goals.push({ goal, mtime: (await stat(path)).mtimeMs });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return goals.sort((a, b) => a.goal.createdAt - b.goal.createdAt
      || (a.goal.creationOrder ?? 0) - (b.goal.creationOrder ?? 0)
      || a.mtime - b.mtime).map(({ goal }) => goal);
  }

  async read(id: string): Promise<Goal | null> {
    return this.readFile(this.path(id));
  }

  private async save(goal: Goal): Promise<void> {
    goalSchema.parse(goal);
    await writeFileAtomic(this.path(goal.id), `${JSON.stringify(goal, null, 2)}\n`);
  }

  async create(input: CreateGoalInput): Promise<Goal> {
    const slug = input.statement.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    const id = input.id ?? `goal-${slug}`;
    const path = this.path(id);
    return withFileLock(join(this.dir, ".write-lock"), async () => {
      const existing = await stat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (existing) throw new Error(`目标 ${id} 已存在`);
      const creationOrder = (await this.list()).reduce((max, goal) => Math.max(max, goal.creationOrder ?? 0), 0) + 1;
      const at = this.now();
      const owner = input.owner ?? "owner";
      const goal: Goal = {
        id, product: input.product, statement: input.statement, owner, status: "active",
        ...(input.metric ? { metric: { ...input.metric } } : {}),
        ...(input.budgetUsd !== undefined ? { budgetUsd: input.budgetUsd } : {}),
        ...(input.due !== undefined ? { due: input.due } : {}),
        windowStart: at, createdAt: at, updatedAt: at, creationOrder,
        history: [{ at, by: input.by ?? owner, note: "created" }],
      };
      await this.save(goal);
      return goal;
    });
  }

  private async update(id: string, note: string, by: string | undefined, change: (goal: Goal, at: number) => void): Promise<Goal | null> {
    this.path(id);
    return withFileLock(join(this.dir, ".write-lock"), async () => {
      const goal = await this.read(id);
      if (!goal) return null;
      const at = this.now();
      change(goal, at);
      goal.updatedAt = at;
      goal.history.push({ at, by: by ?? goal.owner, note });
      await this.save(goal);
      return goal;
    });
  }

  async setStatus(id: string, status: Goal["status"], by?: string): Promise<Goal | null> {
    return this.update(id, `status → ${status}`, by, (goal) => { goal.status = status; });
  }

  async setCurrent(id: string, current: number, by?: string): Promise<Goal | null> {
    return this.update(id, `current=${current}`, by, (goal, at) => {
      if (!goal.metric) throw new Error("目标没有指标");
      goal.metric.current = current;
      goal.metric.updatedAt = at;
    });
  }

  async appendHistory(id: string, note: string, by?: string): Promise<Goal | null> {
    return this.update(id, note, by, () => {});
  }

  async setTarget(id: string, target: number, direction: "up" | "down", note: string, by?: string): Promise<Goal | null> {
    if (!Number.isFinite(target)) throw new Error("目标值必须是有限数");
    return this.update(id, note, by, (goal) => {
      if (goal.metric) {
        goal.metric.target = target;
        goal.metric.direction = direction;
      } else {
        goal.metric = { key: "kr", label: "KR", target, direction };
      }
    });
  }
}

export function goalProgress(goal: Goal): number | undefined {
  const metric = goal.metric;
  if (!metric || metric.current === undefined) return undefined;
  const ratio = metric.direction === "up" ? metric.current / metric.target
    : metric.current === 0 ? 1 : metric.target / metric.current;
  return Math.round(ratio * 10000) / 10000;
}
