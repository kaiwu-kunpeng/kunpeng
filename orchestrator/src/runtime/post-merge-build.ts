import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

export interface PostMergeBuildResult {
  ran: boolean;
  ok: boolean;
  version?: string;
  error?: string;
  ms?: number;
}

export function shouldPostMergeBuild(
  repoRoot: string,
  env: NodeJS.ProcessEnv,
  exists: (p: string) => boolean = existsSync,
): boolean {
  return env.KUNPENG_POST_MERGE_BUILD !== "0"
    && exists(join(repoRoot, "orchestrator", "package.json"))
    && exists(join(repoRoot, "orchestrator", "dist"));
}

async function runCommand(cmd: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await promisify(execFile)(cmd, args, {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 10 * 60_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const err = error as { code?: number | string; stdout?: string; stderr?: string };
    return {
      code: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

export async function postMergeBuild(repoRoot: string, deps?: {
  run?: (cmd: string, args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;
  env?: NodeJS.ProcessEnv;
}): Promise<PostMergeBuildResult> {
  const env = deps?.env ?? process.env;
  // 注入的执行器可使用虚拟仓库；真实执行仍要求已存在构建目录。
  if (!shouldPostMergeBuild(repoRoot, env, deps?.run ? () => true : existsSync)) {
    return { ran: false, ok: true };
  }

  const startedAt = Date.now();
  const cwd = join(repoRoot, "orchestrator");
  const run = deps?.run ?? runCommand;
  const build = await run("npm", ["run", "build"], cwd);
  if (build.code !== 0) {
    return { ran: true, ok: false, error: (build.stderr || build.stdout).trim().slice(-400), ms: Date.now() - startedAt };
  }
  const smoke = await run("node", ["dist/cli.js", "version"], cwd);
  if (smoke.code !== 0) {
    return { ran: true, ok: false, error: (smoke.stderr || smoke.stdout).trim().slice(-400), ms: Date.now() - startedAt };
  }
  return { ran: true, ok: true, version: smoke.stdout.split("\n")[0].trim(), ms: Date.now() - startedAt };
}
