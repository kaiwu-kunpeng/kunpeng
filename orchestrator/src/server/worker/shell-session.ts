import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { scrubExecEnv } from "./exec-env.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  truncated: boolean;
  timedOut: boolean;
}

export interface ShellSession {
  run(
    command: string,
    opts?: {
      timeoutMs?: number;
      maxOutputBytes?: number;
      onOutput?: (stream: "stdout" | "stderr", data: string) => void;
    },
  ): Promise<ExecResult>;
  close(): void;
  isAlive(): boolean;
}

interface OutputState {
  stream: "stdout" | "stderr";
  chunks: Buffer[];
  bytes: number;
  pending: Buffer;
  done: boolean;
  decoder: StringDecoder;
}

interface PendingRun {
  stdout: OutputState;
  stderr: OutputState;
  maxOutputBytes: number;
  onOutput?: (stream: "stdout" | "stderr", data: string) => void;
  truncated: boolean;
  exitCode: number | null;
  settled: boolean;
  timer: NodeJS.Timeout;
  resolve: (result: ExecResult) => void;
  reject: (error: Error) => void;
}

const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;
const EMPTY_BUFFER = Buffer.alloc(0);

function quoteForBash(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function validatedLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function appendOutput(run: PendingRun, output: OutputState, chunk: Buffer): void {
  if (chunk.length === 0) return;
  const remaining = run.maxOutputBytes - output.bytes;
  if (remaining > 0) {
    const kept = chunk.subarray(0, remaining);
    output.chunks.push(Buffer.from(kept));
    output.bytes += kept.length;
    const data = output.decoder.write(kept);
    if (data.length > 0 && run.onOutput) {
      try {
        run.onOutput(output.stream, data);
      } catch (error) {
        try {
          console.error("ShellSession onOutput callback failed:", error);
        } catch {
          // Diagnostic logging must not let a user callback break the command.
        }
      }
    }
  }
  if (chunk.length > remaining) run.truncated = true;
}

function markerPrefixSuffixLength(data: Buffer, markerPrefix: Buffer): number {
  const maxLength = Math.min(data.length, markerPrefix.length - 1);
  for (let length = maxLength; length > 0; length -= 1) {
    if (data.subarray(data.length - length).equals(markerPrefix.subarray(0, length))) {
      return length;
    }
  }
  return 0;
}

function decodeWithinLimit(chunks: Buffer[], bytes: number, limit: number): string {
  const decoded = Buffer.concat(chunks, bytes).toString("utf8");
  if (Buffer.byteLength(decoded) <= limit) return decoded;

  const kept: string[] = [];
  let keptBytes = 0;
  for (const character of decoded) {
    const characterBytes = Buffer.byteLength(character);
    if (keptBytes + characterBytes > limit) break;
    kept.push(character);
    keptBytes += characterBytes;
  }
  return kept.join("");
}

function outputState(stream: "stdout" | "stderr"): OutputState {
  return { stream, chunks: [], bytes: 0, pending: EMPTY_BUFFER, done: false, decoder: new StringDecoder("utf8") };
}

export function createShellSession(opts: { cwd?: string; shell?: string; env?: NodeJS.ProcessEnv } = {}): ShellSession {
  const sessionId = randomBytes(16).toString("hex");
  const cwd = opts.cwd ?? process.cwd();
  const shell = spawn(opts.shell ?? "/bin/bash", [], {
    cwd,
    detached: process.platform !== "win32",
    env: { ...scrubExecEnv(opts.env ?? process.env), PWD: cwd },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let alive = true;
  let runSequence = 0;
  let active: PendingRun | undefined;
  let queue: Promise<void> = Promise.resolve();
  let terminalError: Error | undefined;

  const markerSuffix = Buffer.from([0x1f, 0x0a]);

  function resultFor(run: PendingRun, timedOut: boolean): ExecResult {
    return {
      stdout: decodeWithinLimit(run.stdout.chunks, run.stdout.bytes, run.maxOutputBytes),
      stderr: decodeWithinLimit(run.stderr.chunks, run.stderr.bytes, run.maxOutputBytes),
      exitCode: timedOut ? null : run.exitCode,
      truncated: run.truncated,
      timedOut,
    };
  }

  function stopShell(): void {
    let killedProcessGroup = false;
    if (shell.pid !== undefined && process.platform !== "win32") {
      try {
        process.kill(-shell.pid, "SIGKILL");
        killedProcessGroup = true;
      } catch {
        // The process may have exited between the liveness check and the signal.
      }
    }
    if (!killedProcessGroup) {
      try {
        shell.kill("SIGKILL");
      } catch {
        // close() is deliberately idempotent, including after a natural exit.
      }
    }

    // Killing the process is asynchronous. Drop our pipe handles immediately so
    // a closed session cannot keep the worker (or a test process) alive while the
    // child exit event is still in flight.
    shell.stdin.destroy();
    shell.stdout.destroy();
    shell.stderr.destroy();
    shell.unref();
  }

  function rejectActive(error: Error): void {
    const run = active;
    if (!run || run.settled) return;
    run.settled = true;
    clearTimeout(run.timer);
    active = undefined;
    run.reject(error);
  }

  function endSession(error: Error): void {
    if (!alive) return;
    alive = false;
    terminalError = error;
    rejectActive(error);
  }

  function maybeFinish(run: PendingRun): void {
    if (run.settled || !run.stdout.done || !run.stderr.done) return;
    run.settled = true;
    clearTimeout(run.timer);
    if (active === run) active = undefined;
    run.resolve(resultFor(run, false));
  }

  function consume(
    run: PendingRun,
    output: OutputState,
    chunk: Buffer,
    markerPrefix: Buffer,
    recordsExitCode: boolean,
  ): void {
    if (run.settled || output.done) return;
    const data = output.pending.length === 0 ? chunk : Buffer.concat([output.pending, chunk]);
    const markerStart = data.indexOf(markerPrefix);

    if (markerStart === -1) {
      const pendingBytes = markerPrefixSuffixLength(data, markerPrefix);
      appendOutput(run, output, data.subarray(0, data.length - pendingBytes));
      output.pending = pendingBytes === 0 ? EMPTY_BUFFER : Buffer.from(data.subarray(data.length - pendingBytes));
      return;
    }

    const statusStart = markerStart + markerPrefix.length;
    const markerEnd = data.indexOf(markerSuffix, statusStart);
    if (markerEnd === -1) {
      appendOutput(run, output, data.subarray(0, markerStart));
      output.pending = Buffer.from(data.subarray(markerStart));
      return;
    }

    const statusText = data.subarray(statusStart, markerEnd).toString("ascii");
    if (!/^\d{1,3}$/.test(statusText)) {
      appendOutput(run, output, data.subarray(0, markerStart + 1));
      output.pending = Buffer.from(data.subarray(markerStart + 1));
      consume(run, output, EMPTY_BUFFER, markerPrefix, recordsExitCode);
      return;
    }

    appendOutput(run, output, data.subarray(0, markerStart));
    output.pending = EMPTY_BUFFER;
    output.done = true;
    if (recordsExitCode) run.exitCode = Number(statusText);
    maybeFinish(run);
  }

  shell.stdout.on("data", (chunk: Buffer) => {
    const run = active;
    if (!run) return;
    const markerPrefix = Buffer.from(`\x1eKUNPENG_${sessionId}_${runSequence}:`);
    consume(run, run.stdout, chunk, markerPrefix, true);
  });

  shell.stderr.on("data", (chunk: Buffer) => {
    const run = active;
    if (!run) return;
    const markerPrefix = Buffer.from(`\x1eKUNPENG_${sessionId}_${runSequence}:`);
    consume(run, run.stderr, chunk, markerPrefix, false);
  });

  shell.stdin.on("error", (error: Error) => {
    endSession(new Error(`Shell stdin failed: ${error.message}`));
  });
  shell.once("error", (error) => {
    endSession(new Error(`Failed to start shell: ${error.message}`));
  });
  shell.once("exit", (code, signal) => {
    endSession(new Error(`Shell exited unexpectedly (${signal ?? code ?? "unknown"})`));
  });

  function execute(
    command: string,
    runOpts: {
      timeoutMs?: number;
      maxOutputBytes?: number;
      onOutput?: (stream: "stdout" | "stderr", data: string) => void;
    },
  ): Promise<ExecResult> {
    if (!alive) return Promise.reject(terminalError ?? new Error("Shell session is closed"));

    let timeoutMs: number;
    let maxOutputBytes: number;
    try {
      timeoutMs = validatedLimit("timeoutMs", runOpts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      maxOutputBytes = validatedLimit("maxOutputBytes", runOpts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES);
    } catch (error) {
      return Promise.reject(error);
    }

    runSequence += 1;
    const sequence = runSequence;
    const markerFormat = `\\036KUNPENG_${sessionId}_${sequence}:%s\\037\\n`;

    return new Promise<ExecResult>((resolve, reject) => {
      const run: PendingRun = {
        stdout: outputState("stdout"),
        stderr: outputState("stderr"),
        maxOutputBytes,
        onOutput: runOpts.onOutput,
        truncated: false,
        exitCode: null,
        settled: false,
        timer: setTimeout(() => {
          if (run.settled) return;
          run.stdout.pending = EMPTY_BUFFER;
          run.stderr.pending = EMPTY_BUFFER;
          run.settled = true;
          active = undefined;
          alive = false;
          terminalError = new Error(`Shell command timed out after ${timeoutMs}ms`);
          stopShell();
          resolve(resultFor(run, true));
        }, timeoutMs),
        resolve,
        reject,
      };
      active = run;

      const statusVariable = `__kunpeng_status_${sessionId}`;
      const script = [
        `command eval ${quoteForBash(command)}`,
        `${statusVariable}=$?`,
        `command printf '${markerFormat}' "$${statusVariable}"`,
        `command printf '${markerFormat}' "$${statusVariable}" >&2`,
      ].join("\n") + "\n";

      shell.stdin.write(script, (error) => {
        if (!error || run.settled) return;
        endSession(new Error(`Failed to write shell command: ${error.message}`));
        stopShell();
      });
    });
  }

  return {
    run(command, runOpts = {}) {
      if (!alive) return Promise.reject(terminalError ?? new Error("Shell session is closed"));
      const result = queue.then(() => execute(command, runOpts));
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
    close() {
      if (!alive) return;
      alive = false;
      terminalError = new Error("Shell session is closed");
      rejectActive(terminalError);
      stopShell();
    },
    isAlive() {
      return alive;
    },
  };
}
