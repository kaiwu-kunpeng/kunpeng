import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface EnvCheck {
  ok: boolean;
  missing: string[];
}

type JsonObject = Record<string, unknown>;

export interface EnvInitDeps {
  run?: (cmd: string, args: string[]) => Promise<unknown>;
}

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function hasScript(pkg: JsonObject, name: string): boolean {
  const scripts = asObject(pkg.scripts);
  const value = scripts?.[name];
  return typeof value === "string" && value.trim().length > 0;
}

function dependenciesHave(pkg: JsonObject, field: "dependencies" | "devDependencies", name: string): boolean {
  const deps = asObject(pkg[field]);
  return typeof deps?.[name] === "string";
}

function fieldHas(pkg: JsonObject, field: string, name: string): boolean {
  const value = pkg[field];
  if (typeof value === "string") return value.includes(name);
  const obj = asObject(value);
  return typeof obj?.[name] === "string";
}

function devScriptHas(pkg: JsonObject, name: string): boolean {
  const scripts = asObject(pkg.scripts);
  const dev = scripts?.dev;
  return typeof dev === "string" && dev.includes(name);
}

function hasVitest(pkg: JsonObject): boolean {
  return fieldHas(pkg, "dev", "vitest")
    || devScriptHas(pkg, "vitest")
    || dependenciesHave(pkg, "devDependencies", "vitest")
    || dependenciesHave(pkg, "dependencies", "vitest");
}

async function readPackageJson(repoRoot: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
  } catch {
    return undefined;
  }
}

async function hasNodeModules(repoRoot: string): Promise<boolean> {
  try {
    return (await stat(join(repoRoot, "node_modules"))).isDirectory();
  } catch {
    return false;
  }
}

export function envPreflightFrom(pkg: unknown, hasNodeModulesDir: boolean): EnvCheck {
  const missing: string[] = [];
  const packageObject = asObject(pkg);

  if (!packageObject) missing.push("package.json");
  if (!packageObject || (!hasScript(packageObject, "dev") && !hasScript(packageObject, "start"))) missing.push("dev脚本");
  if (!packageObject || !hasVitest(packageObject)) missing.push("vitest");

  if (!hasNodeModulesDir) missing.push("node_modules");

  return { ok: missing.length === 0, missing };
}

export async function envPreflight(repoRoot: string): Promise<EnvCheck> {
  return envPreflightFrom(await readPackageJson(repoRoot), await hasNodeModules(repoRoot));
}

export async function envInit(repoRoot: string, deps: EnvInitDeps = {}): Promise<{ ran: string[] }> {
  if (!existsSync(join(repoRoot, "package.json"))) return { ran: [] };

  const run = deps.run ?? (async (cmd: string, args: string[]) => {
    await execFileAsync(cmd, args, { cwd: repoRoot });
  });
  const check = await envPreflight(repoRoot);
  const ran: string[] = [];

  if (check.missing.includes("vitest")) {
    const args = ["i", "-D", "vitest", "tsx"];
    await run("npm", args);
    ran.push(["npm", ...args].join(" "));
  }

  if (check.missing.includes("node_modules")) {
    const args = ["install"];
    await run("npm", args);
    ran.push(["npm", ...args].join(" "));
  }

  return { ran };
}
