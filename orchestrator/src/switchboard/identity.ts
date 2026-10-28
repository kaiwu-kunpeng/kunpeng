import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export const INSTANCE_FILE = ".kunpeng-instance";

export interface ResolveIdentityDeps {
  cwd: string;
  flagValue?: string | null;
  env?: string | null;
  readInstanceFile?: (cwd: string) => string | null;
}

export function readInstanceFileSync(cwd: string): string | null {
  try {
    const value = readFileSync(join(cwd, INSTANCE_FILE), "utf8").trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function resolveIdentity(deps: ResolveIdentityDeps): string {
  const flagValue = deps.flagValue?.trim();
  if (flagValue) return flagValue;

  const env = deps.env?.trim();
  if (env) return env;

  const fromFile = (deps.readInstanceFile ?? readInstanceFileSync)(deps.cwd)?.trim();
  if (fromFile) return fromFile;

  return "main";
}

export async function writeInstanceFile(dir: string, id: string): Promise<void> {
  await writeFile(join(dir, INSTANCE_FILE), `${id.trim()}\n`);
}
