import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

// 探测目标项目的真实检查脚本——让鲲鹏的验证门/守护用项目自己的 typecheck/lint/build，
// 而不是玩具命令（TECHDEBT #2）。
// 子包支持：root 无检查时探一级子目录（如 monorepo 的 orchestrator/），命令前缀 `cd <subdir> &&`，
// 让 worktree 内（node_modules 软链在子包下）能正确解析 tsc/eslint（修反复出现的「集成才爆 tsc」类坑）。
export interface ProjectChecks { typecheck?: string; lint?: string; build?: string; test?: string }
export type FrontendFramework = "next" | "angular" | "vue" | "svelte" | "react" | "vite";
export interface FrontendInfo { isFrontend: boolean; framework?: FrontendFramework }

function testCheckScript(scripts: Record<string, string>): string | undefined {
  if (scripts["test:unit"]) return "test:unit";
  if (scripts.test) return "test";
  return undefined;
}

function testCheckCommand(scripts: Record<string, string>, cd: string): string | undefined {
  const testScript = testCheckScript(scripts);
  if (!testScript) return undefined;
  if (testScript !== "test") return `${cd}npm run ${testScript}`;
  if (/\bvitest\b/.test(scripts.test ?? "")) {
    return `${cd}npm test -- --exclude '**/*.integration.test.ts' --exclude '**/*.e2e.test.ts' --exclude '**/*e2e.test.ts'`;
  }
  return `${cd}npm test`;
}

async function detectAt(dir: string, prefix: string): Promise<ProjectChecks> {
  const cd = prefix ? `cd ${prefix} && ` : "";
  let scripts: Record<string, string> = {};
  try {
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    scripts = pkg.scripts ?? {};
  } catch { /* 无 package.json */ }
  const checks: ProjectChecks = {};
  if (scripts.typecheck) checks.typecheck = `${cd}npm run typecheck`;
  else {
    try { await readFile(join(dir, "tsconfig.json"), "utf8"); checks.typecheck = `${cd}npx --no-install tsc --noEmit`; }
    catch { /* 无 tsconfig：跳过 typecheck */ }
  }
  checks.test = testCheckCommand(scripts, cd);
  if (scripts.lint) checks.lint = `${cd}npm run lint`;
  if (scripts.build) checks.build = `${cd}npm run build`;
  return checks;
}

const has = (c: ProjectChecks) => !!(c.typecheck || c.lint || c.build || c.test);

export async function detectChecks(repoRoot: string): Promise<ProjectChecks> {
  const atRoot = await detectAt(repoRoot, "");
  if (has(atRoot)) return atRoot;
  // root 无检查 → 探一级子目录（子包），取第一个有检查的。
  try {
    for (const e of await readdir(repoRoot, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === "node_modules" || e.name.startsWith(".")) continue;
      const sub = await detectAt(join(repoRoot, e.name), e.name);
      if (has(sub)) return sub;
    }
  } catch { /* repoRoot 读不了 */ }
  return atRoot;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function detectFrontendAt(dir: string): Promise<FrontendInfo> {
  let deps: Record<string, unknown> = {};
  try {
    const pkg = objectRecord(JSON.parse(await readFile(join(dir, "package.json"), "utf8")));
    deps = { ...objectRecord(pkg.dependencies), ...objectRecord(pkg.devDependencies) };
  } catch { /* 无 package.json 或 JSON 非法：按无前端依赖处理 */ }
  if ("next" in deps) return { isFrontend: true, framework: "next" };
  if ("@angular/core" in deps) return { isFrontend: true, framework: "angular" };
  if ("vue" in deps) return { isFrontend: true, framework: "vue" };
  if ("svelte" in deps) return { isFrontend: true, framework: "svelte" };
  if ("react" in deps) return { isFrontend: true, framework: "react" };
  if ("vite" in deps) return { isFrontend: true, framework: "vite" };
  return { isFrontend: false };
}

export async function detectFrontend(repoRoot: string): Promise<FrontendInfo> {
  const atRoot = await detectFrontendAt(repoRoot);
  if (atRoot.isFrontend) return atRoot;
  try {
    for (const e of await readdir(repoRoot, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === "node_modules" || e.name.startsWith(".")) continue;
      const sub = await detectFrontendAt(join(repoRoot, e.name));
      if (sub.isFrontend) return sub;
    }
  } catch { /* repoRoot 读不了 */ }
  return { isFrontend: false };
}
