type TodayTask = {
  id: string;
  title?: string;
  status: string;
  source?: "flow" | "store";
  nextStatuses?: string[];
  updatedAt?: number;
  dupCount?: number;
};

type TodayCounts = {
  ready: number;
  needsReview: number;
  running: number;
  blocked: number;
  delivered: number;
};

export type TodaySummary = {
  ready: TodayTask[];
  needsReview: TodayTask[];
  running: TodayTask[];
  blocked: TodayTask[];
  delivered: TodayTask[];
  counts: TodayCounts;
};

function dedupeBucket(tasks: TodayTask[]): TodayTask[] {
  const groups = new Map<string, TodayTask[]>();
  for (const task of tasks) {
    const key = (task.title ?? task.id).trim();
    const group = groups.get(key);
    if (group) {
      group.push(task);
    } else {
      groups.set(key, [task]);
    }
  }

  return Array.from(groups.values(), (group) => {
    const latest = group.reduce((best, task) => {
      const bestTime = best.updatedAt ?? Number.NEGATIVE_INFINITY;
      const taskTime = task.updatedAt ?? Number.NEGATIVE_INFINITY;
      return taskTime > bestTime ? task : best;
    });
    if (group.length === 1) return latest;
    return { ...latest, dupCount: group.length };
  });
}

export function todaySummary(input: { tasks: TodayTask[]; now?: number; windowMs?: number }): TodaySummary {
  const ready = dedupeBucket(input.tasks.filter((task) => task.status === "draft" || task.status === "ready"));
  const needsReview = dedupeBucket(input.tasks.filter((task) => task.status === "needs-review"));
  const running = dedupeBucket(input.tasks.filter((task) => task.status === "running" || task.status === "verifying"));
  const now = input.now ?? Date.now();
  const inWindow = (task: TodayTask): boolean => (
    input.windowMs === undefined
    || (task.updatedAt !== undefined && now - task.updatedAt <= input.windowMs)
  );
  const blocked = dedupeBucket(input.tasks.filter((task) => task.status === "blocked"));
  const delivered = dedupeBucket(input.tasks.filter((task) => task.status === "delivered" && inWindow(task)));

  return {
    ready,
    needsReview,
    running,
    blocked,
    delivered,
    counts: {
      ready: ready.length,
      needsReview: needsReview.length,
      running: running.length,
      blocked: blocked.length,
      delivered: delivered.length,
    },
  };
}
