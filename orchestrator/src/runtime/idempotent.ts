export interface ResumePlan {
  skip: string[];
  next: string | null;
  remaining: string[];
  done: boolean;
}

export function resumeFrom(allStages: string[], completedStages: string[]): ResumePlan {
  const completed = new Set(completedStages);
  const seen = new Set<string>();
  const skip: string[] = [];
  const remaining: string[] = [];

  for (const stage of allStages) {
    if (seen.has(stage)) {
      continue;
    }

    seen.add(stage);

    if (completed.has(stage)) {
      skip.push(stage);
    } else {
      remaining.push(stage);
    }
  }

  return {
    skip,
    next: remaining[0] ?? null,
    remaining,
    done: remaining.length === 0,
  };
}

export function shouldRerun(
  stage: string,
  completedStages: string[],
  opts?: { forceStages?: string[] },
): boolean {
  if (opts?.forceStages?.includes(stage)) {
    return true;
  }

  return !completedStages.includes(stage);
}
