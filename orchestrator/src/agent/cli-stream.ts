import { spawn } from "node:child_process";

export interface KillProcessTreeDeps {
  kill: (pid: number, signal: NodeJS.Signals) => unknown;
}

export function killProcessTree(
  pid: number,
  signal: NodeJS.Signals,
  deps: KillProcessTreeDeps = { kill: process.kill },
): void {
  try {
    deps.kill(-pid, signal);
    return;
  } catch {
    // Windows and already-detached processes may not expose a process group.
  }

  try {
    deps.kill(pid, signal);
  } catch {
    // The process may already have exited.
  }
}

export interface SpawnStreamOpts {
  timeoutMs?: number;
  idleTimeoutMs?: number;
  env?: Record<string, string>;
  replaceEnv?: boolean;
  stdinInput?: string;
  /** 远程中止:signal abort 时杀子进程(SSE 客户端断开 → 停止生成、不再烧 token)。 */
  signal?: AbortSignal;
  onSpawn?: (pid: number) => void;
}

export function spawnStream(
  file: string,
  args: string[],
  cwd: string,
  onLine: (line: string) => void,
  opts: SpawnStreamOpts = {},
): Promise<{ stdout: string; stderr: string; exitCode: number; killedBy?: "wall" | "idle" }> {
  return new Promise((resolve, reject) => {
    const env = opts.replaceEnv ? { ...(opts.env ?? {}) } : { ...process.env, ...(opts.env ?? {}) };
    if (!opts.env || !Object.prototype.hasOwnProperty.call(opts.env, "FORCE_COLOR")) {
      delete env.FORCE_COLOR;
    }

    const child = spawn(file, args, {
      cwd,
      stdio: [opts.stdinInput !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
      env,
      detached: true,
    });
    if (typeof child.pid === "number") opts.onSpawn?.(child.pid);

    if (opts.stdinInput !== undefined && child.stdin) {
      child.stdin.on("error", () => { /* 子进程提前退出导致 EPIPE 时由 close/error 收口 */ });
      child.stdin.write(opts.stdinInput);
      child.stdin.end();
    }

    let stdout = "";
    let stderr = "";
    let lineBuffer = "";
    let done = false;
    let timedOut = false;
    let idleTimedOut = false;
    let abortEscalationTimer: NodeJS.Timeout | undefined;
    let abortHandler: (() => void) | undefined;

    const timer = opts.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
        timedOut = true;
        killProcessTree(child.pid!, "SIGKILL");
      }, opts.timeoutMs);
    let idleTimer: NodeJS.Timeout | undefined;

    const settle = (fn: () => void) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (idleTimer) clearTimeout(idleTimer);
      if (abortEscalationTimer) clearTimeout(abortEscalationTimer);
      if (opts.signal && abortHandler) opts.signal.removeEventListener("abort", abortHandler);
      fn();
    };

    const abortChild = () => {
      if (done) return;
      killProcessTree(child.pid!, "SIGTERM");
      if (abortEscalationTimer) return;
      abortEscalationTimer = setTimeout(() => {
        if (!done) killProcessTree(child.pid!, "SIGKILL");
      }, 4_000);
    };

    if (opts.signal) {
      abortHandler = abortChild;
      if (opts.signal.aborted) abortChild();
      else opts.signal.addEventListener("abort", abortHandler, { once: true });
    }

    const refreshIdleTimer = () => {
      if (opts.idleTimeoutMs === undefined) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idleTimedOut = true;
        killProcessTree(child.pid!, "SIGKILL");
      }, opts.idleTimeoutMs);
    };
    refreshIdleTimer();

    const emitCompleteLines = (text: string) => {
      lineBuffer += text;
      const parts = lineBuffer.split("\n");
      lineBuffer = parts.pop() ?? "";
      for (const line of parts) onLine(line);
    };

    const stdoutStream = child.stdout;
    const stderrStream = child.stderr;
    if (stdoutStream === null || stderrStream === null) {
      killProcessTree(child.pid!, "SIGKILL");
      settle(() => reject(new Error("spawnStream expected piped stdout and stderr")));
      return;
    }

    stdoutStream.on("data", (data: Buffer) => {
      refreshIdleTimer();
      const text = data.toString();
      stdout += text;
      try {
        emitCompleteLines(text);
      } catch (e) {
        killProcessTree(child.pid!, "SIGKILL");
        settle(() => reject(e));
      }
    });
    stderrStream.on("data", (data: Buffer) => {
      refreshIdleTimer();
      stderr += data.toString();
    });
    child.on("error", (e) => settle(() => reject(e)));
    child.on("close", (code) => settle(() => {
      if (lineBuffer.length > 0) onLine(lineBuffer);
      const killedBy = idleTimedOut ? "idle" : timedOut ? "wall" : undefined;
      resolve({
        stdout,
        stderr,
        exitCode: code ?? (killedBy === undefined ? 1 : 124),
        ...(killedBy === undefined ? {} : { killedBy }),
      });
    }));
  });
}
