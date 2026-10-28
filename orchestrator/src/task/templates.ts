import type { Task } from "./model.js";

export interface TaskTemplate {
  type: string;
  title: string;
  description: string;
  requiredFields: string[];
}

export type TaskDraft = Partial<
  Pick<Task, "type" | "title" | "goal" | "acceptanceCriteria">
> &
  Record<string, unknown>;

export interface TaskDraftValidation {
  ok: boolean;
  problems: string[];
}

export function validateTaskDraft(draft: TaskDraft): TaskDraftValidation {
  const problems: string[] = [];

  if (!hasNonEmptyType(draft.type)) {
    problems.push("缺少任务类型");
  }

  if (!hasNonEmptyText(draft.goal)) {
    problems.push("缺少明确目标");
  } else if (draft.goal.trim().length < 10) {
    problems.push("目标太模糊");
  }

  if (!hasAcceptanceCriteria(draft.acceptanceCriteria)) {
    problems.push("缺少验收标准");
  }

  return {
    ok: problems.length === 0,
    problems,
  };
}

function hasNonEmptyType(value: unknown): value is string {
  return hasNonEmptyText(value);
}

function hasNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasAcceptanceCriteria(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.some((criterion) => hasNonEmptyText(criterion))
  );
}
