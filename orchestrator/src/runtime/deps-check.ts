import { isRecord } from "../util/is-record.js";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

type PackageJson = {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
};

function readDeps(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  if (!isRecord(value)) return undefined;
  return Object.keys(value);
}

export async function checkDepsSync(pkgRoot: string): Promise<{ missing: string[] }> {
  let pkg: PackageJson;
  try {
    const raw = await readFile(join(pkgRoot, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return { missing: [] };
    pkg = parsed;
  } catch {
    return { missing: [] };
  }

  const dependencies = readDeps(pkg.dependencies);
  const devDependencies = readDeps(pkg.devDependencies);
  if (!dependencies || !devDependencies) return { missing: [] };

  const names = [...new Set([...dependencies, ...devDependencies])];
  const missing: string[] = [];
  for (const name of names) {
    try {
      await access(join(pkgRoot, "node_modules", name, "package.json"));
    } catch {
      missing.push(name);
    }
  }

  return { missing };
}
