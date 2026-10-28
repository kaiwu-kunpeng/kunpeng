import { randomUUID } from "node:crypto";

export interface ExecOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  truncated: boolean;
  timedOut: boolean;
}

export interface PendingExec {
  execId: string;
  conv: string;
  command: string;
  submittedAt: number;
}

export interface ExecQueue {
  submit(
    conv: string,
    command: string,
    opts?: { timeoutMs?: number },
  ): { execId: string; result: Promise<ExecOutcome> };
  take(conv: string): PendingExec | null;
  pushChunk(execId: string, stream: "stdout" | "stderr", data: string): boolean;
  complete(execId: string, outcome: { exitCode: number; truncated?: boolean }): boolean;
  abort(execId: string, message: string): boolean;
  onChunk(
    execId: string,
    listener: (stream: "stdout" | "stderr", data: string) => void,
  ): () => void;
  pendingCount(): number;
}

interface PendingState {
  exec: PendingExec;
  taken: boolean;
  stdout: string[];
  stderr: string[];
  listeners: Set<(stream: "stdout" | "stderr", data: string) => void>;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (outcome: ExecOutcome) => void;
}

const DEFAULT_TIMEOUT_MS = 600_000;

export function createExecQueue(deps?: {
  now?: () => number;
  id?: () => string;
}): ExecQueue {
  const now = deps?.now ?? Date.now;
  const id = deps?.id ?? randomUUID;
  const pendingById = new Map<string, PendingState>();
  const execIdsByConv = new Map<string, string[]>();

  function remove(execId: string): PendingState | undefined {
    const pending = pendingById.get(execId);
    if (!pending) return undefined;

    pendingById.delete(execId);
    const queue = execIdsByConv.get(pending.exec.conv);
    if (queue) {
      const index = queue.indexOf(execId);
      if (index >= 0) queue.splice(index, 1);
      if (queue.length === 0) execIdsByConv.delete(pending.exec.conv);
    }
    clearTimeout(pending.timeout);
    pending.listeners.clear();
    return pending;
  }

  function outputOf(pending: PendingState): Pick<ExecOutcome, "stdout" | "stderr"> {
    return {
      stdout: pending.stdout.join(""),
      stderr: pending.stderr.join(""),
    };
  }

  return {
    submit(conv, command, opts) {
      const execId = id();
      if (pendingById.has(execId)) {
        throw new Error(`duplicate exec id: ${execId}`);
      }

      const exec: PendingExec = {
        execId,
        conv,
        command,
        submittedAt: now(),
      };
      let resolveResult!: (outcome: ExecOutcome) => void;
      const result = new Promise<ExecOutcome>((resolve) => {
        resolveResult = resolve;
      });
      const timeout = setTimeout(() => {
        const removed = remove(execId);
        if (!removed) return;
        removed.resolve({
          ...outputOf(removed),
          exitCode: null,
          truncated: false,
          timedOut: true,
        });
      }, opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      pendingById.set(execId, {
        exec,
        taken: false,
        stdout: [],
        stderr: [],
        listeners: new Set(),
        timeout,
        resolve: resolveResult,
      });
      const queue = execIdsByConv.get(conv) ?? [];
      queue.push(execId);
      execIdsByConv.set(conv, queue);

      return { execId, result };
    },

    take(conv) {
      const queue = execIdsByConv.get(conv);
      if (!queue) return null;

      while (queue.length > 0) {
        const execId = queue.shift();
        if (execId === undefined) break;
        const pending = pendingById.get(execId);
        if (!pending || pending.taken) continue;
        pending.taken = true;
        if (queue.length === 0) execIdsByConv.delete(conv);
        return pending.exec;
      }

      execIdsByConv.delete(conv);
      return null;
    },

    pushChunk(execId, stream, data) {
      const pending = pendingById.get(execId);
      if (!pending) return false;

      pending[stream].push(data);
      for (const listener of pending.listeners) listener(stream, data);
      return true;
    },

    complete(execId, outcome) {
      const removed = remove(execId);
      if (!removed) return false;
      removed.resolve({
        ...outputOf(removed),
        exitCode: outcome.exitCode,
        truncated: outcome.truncated ?? false,
        timedOut: false,
      });
      return true;
    },

    abort(execId, message) {
      const removed = remove(execId);
      if (!removed) return false;
      removed.resolve({
        ...outputOf(removed),
        stderr: `${removed.stderr.join("")}${message}`,
        exitCode: null,
        truncated: false,
        timedOut: false,
      });
      return true;
    },

    onChunk(execId, listener) {
      const pending = pendingById.get(execId);
      if (!pending) return () => {};

      pending.listeners.add(listener);
      return () => {
        pending.listeners.delete(listener);
      };
    },

    pendingCount() {
      return pendingById.size;
    },
  };
}
