import { createTask } from "../task/store.js";
import { readLoopState, writeLoopState } from "./loop-store.js";
import { prdSourceFromDefinition, tasksFromPrd } from "./prd-to-tasks.js";

export async function createTaskBatchForBuild(
  repoRoot: string,
  slug: string,
  title: string,
  def: { stories: string[] },
  now: number,
): Promise<string[]> {
  const drafts = tasksFromPrd(prdSourceFromDefinition(title, def));
  if (drafts.length === 0) return [];

  const createdAt = new Date(now).toISOString();
  const ids: string[] = [];
  for (const [i, draft] of drafts.entries()) {
    const id = `task-${now}-${i}-${slug}`;
    await createTask(repoRoot, {
      id,
      projectId: slug,
      status: "ready",
      createdAt,
      updatedAt: createdAt,
      title: draft.title,
      type: draft.type,
      goal: draft.goal,
      acceptanceCriteria: draft.acceptanceCriteria,
    });
    ids.push(id);
  }

  const state = await readLoopState(repoRoot, slug);
  if (state) {
    await writeLoopState(repoRoot, {
      ...state,
      buildTasks: { ids, createdAt: now },
    });
  }

  return ids;
}
