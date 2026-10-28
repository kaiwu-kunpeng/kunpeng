export type PrdStory = {
  title: string;
  acceptance?: string[];
};

export type PrdTaskSource = {
  title: string;
  stories: PrdStory[];
};

export type TaskDraft = {
  type: "feature";
  title: string;
  goal: string;
  acceptanceCriteria: string[];
};

export function prdSourceFromDefinition(title: string, def: { stories: string[] }): PrdTaskSource {
  return {
    title,
    stories: def.stories.filter(Boolean).map((story) => ({ title: story })),
  };
}

export function tasksFromPrd(prd: PrdTaskSource): TaskDraft[] {
  return prd.stories.map((story) => ({
    type: "feature",
    title: `${prd.title} - ${story.title}`,
    goal: `实现「${story.title}」，支撑「${prd.title}」。`,
    acceptanceCriteria: story.acceptance ?? [],
  }));
}
