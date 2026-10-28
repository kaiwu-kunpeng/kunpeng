import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SensitiveHit } from "./sensitive-paths.js";

export const SENSITIVE_DIFF_TIMEOUT_MS = 60_000;
export const SENSITIVE_DIFF_MAX_BUFFER = 16 * 1024 * 1024;

const execFileAsync = promisify(execFile);

export function isTestFile(path: string): boolean {
  return /\.(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/.test(path)
    || /(?:^|\/)spec-accept\/[^/]+\.[cm]?[jt]s$/.test(path);
}

/** 只看削弱信号；新增覆盖与文案改动不触发人工门。 */
export function testWeakening(before: string, after: string): string | null {
  const count = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;
  const modifiers = /\.(?:skip|only|todo)\(|\b(?:skip|only|todo)\s*:\s*true\b/g;
  if (count(after, modifiers) > count(before, modifiers)) return "skip/only/todo 增多";

  const cases = /\b(?:it|test)(?:\.each\([^)]*\))?\s*\(/g;
  if (count(after, cases) < count(before, cases)) return "用例变少";
  const assertions = /\b(?:expect|assert(?:\.\w+)?)\s*\(/g;
  if (count(after, assertions) < count(before, assertions)) return "断言变少";
  return null;
}

export function scriptsChanged(before: string, after: string): boolean {
  const sortedScripts = (text: string): string => {
    const pkg = JSON.parse(text) as { scripts?: Record<string, unknown> };
    const scripts = pkg.scripts ?? {};
    return JSON.stringify(Object.keys(scripts).sort().map((key) => [key, scripts[key]]));
  };
  try {
    return sortedScripts(before) !== sortedScripts(after);
  } catch {
    return true;
  }
}

export async function contentSensitiveHits(
  repoRoot: string,
  flowId: string,
  base: string,
  git: (args: string[]) => Promise<string> = async (args) => {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repoRoot,
      timeout: SENSITIVE_DIFF_TIMEOUT_MS,
      maxBuffer: SENSITIVE_DIFF_MAX_BUFFER,
    });
    return stdout;
  },
): Promise<SensitiveHit[]> {
  const branch = `kp/${flowId}`;
  const fork = (await git(["merge-base", base, branch])).trim();
  const output = await git(["diff", "--no-renames", "--name-status", `${base}...${branch}`]);
  const hits: SensitiveHit[] = [];
  for (const line of output.split(/\r?\n/)) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const status = line.slice(0, tab);
    const file = line.slice(tab + 1);
    const isTest = isTestFile(file);
    if (isTest && status === "D") {
      hits.push({ file, label: "删除既有测试" });
      continue;
    }
    if (status !== "M" || (!isTest && !file.endsWith("package.json"))) continue;
    const [before, after] = await Promise.all([
      git(["show", `${fork}:${file}`]),
      git(["show", `${branch}:${file}`]),
    ]);
    if (isTest && testWeakening(before, after) !== null) {
      hits.push({ file, label: "削弱既有测试" });
    } else if (!isTest && scriptsChanged(before, after)) {
      hits.push({ file, label: "测试/构建脚本改动" });
    }
  }
  return hits;
}
