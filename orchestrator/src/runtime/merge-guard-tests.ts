import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gitWithWallClock } from "../git/git-wall.js";

export const DEFAULT_GUARD_TEST_FILTERS: readonly string[] = [
  "sensitive-paths", "sensitive-control-plane", "sensitive-branch", "merge-gate",
  "merge-deletion-guard", "gate-ledger", "gate-mode", "hooks", "authz",
  "scope-main-gate", "scope-gate", "autopilot", "p0-regression", "flowstate-cas",
  "control-plane-audit",
];

export function resolveGuardTestFilters(env: NodeJS.ProcessEnv): string[] {
  const configured = env.KUNPENG_GUARD_TESTS;
  if (configured === undefined) return [...DEFAULT_GUARD_TEST_FILTERS];
  if (["off", "0", "false"].includes(configured.trim().toLowerCase())) return [];
  return configured.split(",").map((filter) => filter.trim()).filter(Boolean);
}

export interface GuardTestResult {
  status: "green" | "red" | "skipped";
  summary: string;
  durationMs: number;
  logPath?: string;
}

export type GuardExec = (file: string, args: string[], cwd: string, timeoutMs: number) => Promise<{ exitCode: number; output: string }>;

const defaultGuardExec: GuardExec = (file, args, cwd, timeoutMs) => new Promise((done) => {
  execFile(file, args, { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
    done({ exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0, output: stdout + stderr });
  });
});

async function writeGuardLog(repoRoot: string, flowId: string, filters: readonly string[], output: string): Promise<string> {
  const dir = join(repoRoot, ".kunpeng", "guard-logs", flowId);
  await mkdir(dir, { recursive: true });
  let next = 1;
  for (const entry of await readdir(dir)) {
    const match = /^(\d+)\.txt$/.exec(entry);
    if (match && Number.isSafeInteger(Number(match[1]))) next = Math.max(next, Number(match[1]) + 1);
  }
  const content = `# kunpeng guard log · flow=${flowId} at=${new Date().toISOString()}\n# cmd: npx --no-install vitest run ${filters.join(" ")}\n${output}`;
  // 守门测试在合并锁外运行；同流并发写日志时也不能覆盖另一轮证据。
  for (;;) {
    const path = join(dir, `${next}.txt`);
    try {
      await writeFile(path, content, { flag: "wx" });
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      next += 1;
    }
  }
}

export async function runGuardTests(opts: {
  repoRoot: string;
  flowId: string;
  base: string;
  filters: readonly string[];
  timeoutMs?: number;
  exec?: GuardExec;
  log?: (line: string) => void;
}): Promise<GuardTestResult> {
  const { repoRoot, flowId, base, filters } = opts;
  if (filters.length === 0) {
    return { status: "skipped", summary: "守门测试已关闭（KUNPENG_GUARD_TESTS=off 或空）", durationMs: 0 };
  }
  if (!existsSync(join(repoRoot, "orchestrator", "package.json"))) {
    return { status: "skipped", summary: "该仓库没有 orchestrator 测试集，跳过守门测试", durationMs: 0 };
  }

  const startedAt = Date.now();
  const timeoutMs = opts.timeoutMs ?? 8 * 60_000;
  const log = opts.log ?? ((line: string) => console.warn(`[merge-guard-tests] ${line}`));
  const git = gitWithWallClock(repoRoot);
  const path = await mkdtemp(join(tmpdir(), "kp-guard-"));
  try {
    await git.raw(["worktree", "add", "--detach", path, `kp/${flowId}`]);
    const nodeModules = resolve(repoRoot, "orchestrator", "node_modules");
    if (existsSync(nodeModules)) await symlink(nodeModules, join(path, "orchestrator", "node_modules"), "dir");

    const preview = gitWithWallClock(path);
    try {
      await preview.merge(["--no-commit", "--no-ff", base]);
    } catch (error) {
      await preview.merge(["--abort"]).catch(() => undefined);
      const firstLine = String(error).split(/\r?\n/)[0];
      return { status: "skipped", summary: `预览合并冲突或失败，交给刷新闸处理：${firstLine}`, durationMs: Date.now() - startedAt };
    }

    const timeoutSummary = `守门测试超时(${timeoutMs}ms)`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let result: { exitCode: number; output: string; timedOut?: boolean };
    try {
      const timeout = new Promise<{ exitCode: number; output: string; timedOut: boolean }>((done) => {
        timer = setTimeout(() => done({ exitCode: 1, output: timeoutSummary, timedOut: true }), timeoutMs);
      });
      const running = Promise.resolve().then(() => (opts.exec ?? defaultGuardExec)(
        "npx", ["--no-install", "vitest", "run", ...filters], join(path, "orchestrator"), timeoutMs,
      ));
      result = await Promise.race([running, timeout]);
    } catch (error) {
      result = { exitCode: 1, output: String(error) };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    let logPath: string | undefined;
    try {
      logPath = await writeGuardLog(repoRoot, flowId, filters, result.output);
    } catch (error) {
      log(`守门日志落盘失败 flow=${flowId}：${String(error)}`);
    }
    const green = result.exitCode === 0;
    return {
      status: green ? "green" : "red",
      summary: result.timedOut ? timeoutSummary : green ? `守门测试全绿（${filters.length} 组）`
        : result.output.split(/\r?\n/).slice(-40).filter((line) => line.trim()).join("\n").slice(0, 2000),
      durationMs: Date.now() - startedAt,
      ...(logPath === undefined ? {} : { logPath }),
    };
  } finally {
    await git.raw(["worktree", "remove", "--force", path]).catch((error: unknown) => {
      log(`移除守门 worktree 失败：${String(error)}`);
    });
    // add 失败时目录可能尚未注册为 worktree；仍清掉本轮创建的临时目录。
    await rm(path, { recursive: true, force: true }).catch((error: unknown) => {
      log(`清理守门临时目录失败：${String(error)}`);
    });
    await git.raw(["worktree", "prune"]).catch((error: unknown) => {
      log(`守门 worktree prune 失败：${String(error)}`);
    });
  }
}
