export interface GoldenTask {
  id: string;
  requirement: string;
  acceptCmd: string;
  harvestedAt: number;
}

export interface GoldenRegression {
  id: string;
  acceptCmd: string;
  stderrTail: string;
}

export interface GoldenSuiteResult {
  total: number;
  passed: number;
  regressions: GoldenRegression[];
}

export function harvestGoldenTask(
  record: { flowId: string; requirement?: string; acceptCmd?: string },
  now: () => number,
): GoldenTask | null {
  if (!record.acceptCmd?.trim()) return null;

  return {
    id: record.flowId,
    requirement: record.requirement ?? "",
    acceptCmd: record.acceptCmd,
    harvestedAt: now(),
  };
}

export async function runGoldenSuite(input: {
  tasks: GoldenTask[];
  exec: (cmd: string) => Promise<{ code: number; stderr: string }>;
}): Promise<GoldenSuiteResult> {
  const regressions: GoldenRegression[] = [];
  let passed = 0;

  for (const task of input.tasks) {
    const result = await input.exec(task.acceptCmd);
    if (result.code === 0) {
      passed += 1;
      continue;
    }
    regressions.push({
      id: task.id,
      acceptCmd: task.acceptCmd,
      stderrTail: result.stderr.slice(-500),
    });
  }

  return { total: input.tasks.length, passed, regressions };
}
