import { newFailures } from "./gate.js";

export interface DiffSample {
  baseline: string;
  after: string;
}

export interface ConfirmedDiff {
  regressions: string[];
  flakes: string[];
}

export async function confirmRegressions(
  first: DiffSample,
  rerun: () => Promise<DiffSample>,
): Promise<ConfirmedDiff> {
  const suspected = newFailures(first.baseline, first.after);
  if (suspected.length === 0) return { regressions: [], flakes: [] };

  const second = await rerun();
  const reproduced = new Set(
    newFailures(`${first.baseline}\n${second.baseline}`, second.after),
  );

  return {
    regressions: suspected.filter((line) => reproduced.has(line)),
    flakes: suspected.filter((line) => !reproduced.has(line)),
  };
}
