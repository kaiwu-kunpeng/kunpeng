import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function resolveRepoRootFromCwd(
  start: string,
  hasKunpengDir?: (dir: string) => boolean,
): string {
  const resolvedStart = resolve(start);
  const injectedLookup = hasKunpengDir !== undefined;
  const containsKunpengDir = hasKunpengDir
    ?? ((dir: string) => existsSync(join(dir, ".kunpeng")));
  let firstMatch: string | undefined;
  let current = resolvedStart;

  while (true) {
    if (containsKunpengDir(current)) {
      if (injectedLookup || existsSync(join(current, ".git"))) return current;
      firstMatch ??= current;
    }
    const parent = dirname(current);
    if (parent === current) return firstMatch ?? resolvedStart;
    current = parent;
  }
}
