import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Call = { file: string; args: string[]; opts: Record<string, unknown> | undefined };
const syncCalls: Call[] = [];
const asyncCalls: Call[] = [];

// 记录每次子进程调用的参数；git 照常执行，launchctl / tmux 不真跑。
vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  const execFileSync = (file: string, args: string[] = [], opts?: Record<string, unknown>) => {
    syncCalls.push({ file, args, opts });
    if (file === "git") return (real.execFileSync as (f: string, a: string[], o?: unknown) => unknown)(file, args, opts);
    return "";
  };
  const execFile = (file: string, args: string[], ...rest: unknown[]) => {
    const cb = rest.find((r): r is (err: Error | null) => void => typeof r === "function");
    const opts = rest.find((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
    asyncCalls.push({ file, args, opts });
    cb?.(new Error("tmux 会话不存在"));
    return undefined;
  };
  return { ...real, execFileSync, execFile, default: { ...real, execFileSync, execFile } };
});

const { resolveCapturesDir } = await import("../../src/knowledge/capture-store.js");
const { canonicalRepoRoot } = await import("../../src/project/state-resolve.js");
const { realDaemonIo } = await import("../../src/runtime/daemon-schedule.js");
const { tmuxPtyFactory } = await import("../../src/server/pty-tmux-factory.js");

function timeoutOf(call: Call | undefined): number {
  expect(call, "应发生一次子进程调用").toBeDefined();
  const t = call?.opts?.timeout;
  expect(typeof t, `${call?.file} ${call?.args.join(" ")} 必须带 timeout`).toBe("number");
  return t as number;
}

let dir: string;
beforeEach(() => {
  syncCalls.length = 0;
  asyncCalls.length = 0;
  dir = mkdtempSync(join(tmpdir(), "kp-sync-timeout-"));
  vi.stubEnv("KUNPENG_CAPTURES_ROOT", join(dir, "captures"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("同步子进程必须带超时（作者锁定）", () => {
  test("知识库 captureKey 查 git remote：5–10 秒超时", () => {
    resolveCapturesDir(join(dir, "repo-a"));
    const call = syncCalls.find((c) => c.file === "git" && c.args.includes("remote.origin.url"));
    const t = timeoutOf(call);
    expect(t).toBeGreaterThanOrEqual(5_000);
    expect(t).toBeLessThanOrEqual(10_000);
  });

  test("canonicalRepoRoot 查 git-common-dir：5–10 秒超时", () => {
    canonicalRepoRoot(join(dir, "repo-b"));
    const call = syncCalls.find((c) => c.file === "git" && c.args.includes("--git-common-dir"));
    const t = timeoutOf(call);
    expect(t).toBeGreaterThanOrEqual(5_000);
    expect(t).toBeLessThanOrEqual(10_000);
  });

  test("daemon 调度的 launchctl：15 秒超时", () => {
    realDaemonIo().exec("launchctl", ["list"]);
    const call = syncCalls.find((c) => c.file === "launchctl");
    expect(timeoutOf(call)).toBe(15_000);
  });

  test("关闭终端时 tmux kill-session：5 秒超时，出错打 warn 而不是吞掉", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const handle = { write: () => undefined, resize: () => undefined, onData: () => undefined, onExit: () => undefined, kill: () => undefined };
    const spawnPty = tmuxPtyFactory("/usr/bin/tmux", { ptySpawn: () => handle });
    spawnPty({ id: "demo-term", shell: "/bin/sh", cols: 80, rows: 24, cwd: dir }).kill();
    const call = asyncCalls.find((c) => c.args[0] === "kill-session");
    expect(timeoutOf(call)).toBe(5_000);
    const warned = warn.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
    expect(warned).toMatch(/tmux/);
    expect(warned).toContain("tmux 会话不存在");
  });
});