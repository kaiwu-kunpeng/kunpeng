import simpleGit, { type SimpleGit } from "simple-git";

const DEFAULT_GIT_WALL_MS = 600_000;

export function gitWallClockMs(): number {
  const configuredMs = Number(process.env.KUNPENG_GIT_WALL_MS);
  return Number.isInteger(configuredMs) && configuredMs > 0 ? configuredMs : DEFAULT_GIT_WALL_MS;
}

export function gitWithWallClock(baseDir: string): SimpleGit {
  return simpleGit({ baseDir, timeout: { block: gitWallClockMs() } });
}
