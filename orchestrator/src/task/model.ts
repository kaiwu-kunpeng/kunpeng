import { z } from "zod";
import { randomUUID } from "node:crypto";

export const TASK_STATUSES = [
  "draft",
  "ready",
  "running",
  "verifying",
  "needs-review",
  "delivered",
  "blocked",
  "archived",
] as const;

const TaskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskSchema = z.object({
  id: z.string().default(() => `task-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`),
  title: z.string(),
  type: z.string(),
  projectId: z.string().default(""),
  status: TaskStatusSchema.default("draft"),
  createdAt: z.string().default(() => new Date().toISOString()),
  updatedAt: z.string().default(() => new Date().toISOString()),
  goal: z.string().optional(),
  context: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  priority: z.string().optional(),
  dueAt: z.string().optional(),
  budget: z.string().optional(),
});
export type Task = z.infer<typeof TaskSchema>;

const ALLOWED_TRANSITIONS = new Set<string>([
  "draft->ready",
  "ready->running",
  "running->verifying",
  "verifying->needs-review",
  "verifying->delivered",
  "needs-review->delivered",
  "needs-review->running",
  "ready->blocked",
  "running->blocked",
  "verifying->blocked",
  "needs-review->blocked",
  "blocked->ready",
  "delivered->archived",
]);

export function canTransition(from: string, to: string): boolean {
  return ALLOWED_TRANSITIONS.has(`${from}->${to}`);
}

export function nextStatuses(from: string): TaskStatus[] {
  return TASK_STATUSES.filter((to) => ALLOWED_TRANSITIONS.has(`${from}->${to}`));
}
