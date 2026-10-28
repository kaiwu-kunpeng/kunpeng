import { spawn as nodeSpawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export type SpawnFn = typeof nodeSpawn;

export interface LaunchDeps {
  execPath: string;
  cliJs: string;
  spawn?: SpawnFn;
}

export interface LaunchResult { pid: number; logPath: string }

/** detached 拉起 `node <cliJs> <...args>`；arg 数组绝不走 shell（防注入）；返回子进程 pid 与日志路径。 */
export function launchKunpeng(deps: LaunchDeps, args: string[], cwd: string): LaunchResult {
  const spawn = deps.spawn ?? nodeSpawn;
  const logDir = join(cwd, ".kunpeng", "cockpit", "logs");
  mkdirSync(logDir, { recursive: true });
  const slug = (args[0] ?? "job").replace(/[^a-z0-9]+/gi, "-").slice(0, 20) || "job";
  const logPath = join(logDir, `${slug}-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}.log`);
  const fd = openSync(logPath, "a");
  let ok = false;
  try {
    const child = spawn(deps.execPath, [deps.cliJs, ...args], {
      cwd, detached: true, stdio: ["ignore", fd, fd],
      env: { ...process.env, KUNPENG_FLOW_LOG: logPath },
    });
    child.unref?.();
    if (typeof child.pid !== "number") throw new Error("启动失败：子进程无 pid");
    ok = true;
    return { pid: child.pid, logPath };
  } finally {
    closeSync(fd);
    // 启动失败（spawn 抛/无 pid）则删掉刚开的空日志，不留孤儿文件。
    if (!ok) { try { unlinkSync(logPath); } catch { /* 已不在则忽略 */ } }
  }
}

/** 构造 `kunpeng run` 参数数组（纯函数）。requirement 空则抛。 */
export function runArgs(requirement: string, repoRoot: string, acceptanceCmd?: string): string[] {
  if (!requirement.trim()) throw new Error("requirement 不能为空");
  const args = ["run", requirement, "--repo", repoRoot];
  if (acceptanceCmd?.trim()) args.push("--accept", acceptanceCmd);
  return args;
}

/** 构造 `kunpeng resume <flowId> --repo <repo>` 参数数组（纯函数，cockpit resume 按钮用）。flowId 空则抛。 */
export function resumeArgs(flowId: string, repoRoot: string): string[] {
  if (!flowId.trim()) throw new Error("flowId 不能为空");
  return ["resume", flowId, "--repo", repoRoot];
}

/** 构造 `kunpeng loop run --id <loopId> --repo <repo>` 参数数组（纯函数）。loopId 空则抛。 */
export function loopRunArgs(loopId: string, repoRoot: string): string[] {
  if (!loopId.trim()) throw new Error("loopId 不能为空");
  return ["loop", "run", "--id", loopId, "--repo", repoRoot];
}

/** 构造 `kunpeng ops run-playbook <playbookId> --repo <repo>` 参数数组（纯函数）。 */
export function opsRunPlaybookArgs(playbookId: string, repoRoot: string): string[] {
  if (!playbookId.trim()) throw new Error("playbookId 不能为空");
  return ["ops", "run-playbook", playbookId, "--repo", repoRoot];
}

/** 构造 `kunpeng plan` 参数数组（纯函数）。planPath 空则抛。 */
export function planArgs(planPath: string, repoRoot: string): string[] {
  if (!planPath.trim()) throw new Error("planPath 不能为空");
  return ["plan", planPath, "--repo", repoRoot];
}

/** 构造 `kunpeng design-loop --brief … --generate` 参数（纯函数,#7 面板异步生成用）。briefPath 空则抛。 */
export function designGenerateArgs(briefPath: string, outDir: string, repoRoot: string, opts?: { seed?: string; anchors?: string[]; rounds?: number }): string[] {
  if (!briefPath.trim()) throw new Error("briefPath 不能为空");
  const args = ["design-loop", "--brief", briefPath, "--generate", "--out", outDir, "--repo", repoRoot, "--rounds", String(opts?.rounds ?? 2)];
  if (opts?.seed?.trim()) args.push("--seed", opts.seed);
  if (opts?.anchors?.length) args.push("--anchors", opts.anchors.join(","));
  return args;
}

/** 构造 `kunpeng design-preview --repo <repo>` 参数数组（纯函数，候选生成入口用）。 */
export function designPreviewArgs(repoRoot: string, opts?: { sources?: string; preset?: string }): string[] {
  const args = ["design-preview", "--repo", repoRoot];
  if (opts?.sources !== undefined) args.push("--sources", opts.sources);
  if (opts?.preset) args.push("--preset", opts.preset);
  return args;
}
