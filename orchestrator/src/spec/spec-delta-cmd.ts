import { diffEarsSpecs, formatSpecDelta } from "./delta-spec.js";

export interface SpecDeltaReader {
  readFile(path: string): string;
}

export function runSpecDelta(basePath: string, nextPath: string, io: SpecDeltaReader): number {
  const base = io.readFile(basePath);
  const next = io.readFile(nextPath);
  const delta = diffEarsSpecs(base, next);

  console.log(formatSpecDelta(delta));
  for (const requirement of delta.added) {
    console.log(`+ ${requirement.raw}`);
  }
  for (const requirement of delta.removed) {
    console.log(`- ${requirement.raw}`);
  }

  return 0;
}
