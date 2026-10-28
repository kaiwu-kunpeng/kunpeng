import { randomUUID } from "node:crypto";
import type { WorkerFsOp } from "./tool-surface.js";

export interface FsOutcome {
  ok: boolean;
  data?: string;
  error?: string;
  encoding?: "text" | "base64";
  timedOut: boolean;
}

export interface PendingFsOp {
  opId: string;
  conv: string;
  op: WorkerFsOp;
  submittedAt: number;
}

export interface FsQueue {
  submit(
    conv: string,
    op: WorkerFsOp,
    opts?: { timeoutMs?: number },
  ): { opId: string; result: Promise<FsOutcome> };
  take(conv: string): PendingFsOp | null;
  settle(
    opId: string,
    outcome: { ok: boolean; data?: string; error?: string; encoding?: unknown },
  ): boolean;
  pendingCount(): number;
}

interface PendingState {
  operation: PendingFsOp;
  taken: boolean;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (outcome: FsOutcome) => void;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function createFsQueue(deps?: {
  now?: () => number;
  id?: () => string;
}): FsQueue {
  const now = deps?.now ?? Date.now;
  const id = deps?.id ?? randomUUID;
  const pendingById = new Map<string, PendingState>();
  const opIdsByConv = new Map<string, string[]>();

  function remove(opId: string): PendingState | undefined {
    const pending = pendingById.get(opId);
    if (!pending) return undefined;

    pendingById.delete(opId);
    const queue = opIdsByConv.get(pending.operation.conv);
    if (queue) {
      const index = queue.indexOf(opId);
      if (index >= 0) queue.splice(index, 1);
      if (queue.length === 0) opIdsByConv.delete(pending.operation.conv);
    }
    clearTimeout(pending.timeout);
    return pending;
  }

  return {
    submit(conv, op, opts) {
      const opId = id();
      if (pendingById.has(opId)) {
        throw new Error(`duplicate fs operation id: ${opId}`);
      }

      const operation: PendingFsOp = {
        opId,
        conv,
        op,
        submittedAt: now(),
      };
      let resolveResult!: (outcome: FsOutcome) => void;
      const result = new Promise<FsOutcome>((resolve) => {
        resolveResult = resolve;
      });
      const timeout = setTimeout(() => {
        const removed = remove(opId);
        if (!removed) return;
        removed.resolve({
          ok: false,
          timedOut: true,
          error: "文件操作超时",
        });
      }, opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      pendingById.set(opId, {
        operation,
        taken: false,
        timeout,
        resolve: resolveResult,
      });
      const queue = opIdsByConv.get(conv) ?? [];
      queue.push(opId);
      opIdsByConv.set(conv, queue);

      return { opId, result };
    },

    take(conv) {
      const queue = opIdsByConv.get(conv);
      if (!queue) return null;

      while (queue.length > 0) {
        const opId = queue.shift();
        if (opId === undefined) break;
        const pending = pendingById.get(opId);
        if (!pending || pending.taken) continue;
        pending.taken = true;
        if (queue.length === 0) opIdsByConv.delete(conv);
        return pending.operation;
      }

      opIdsByConv.delete(conv);
      return null;
    },

    settle(opId, outcome) {
      const removed = remove(opId);
      if (!removed) return false;
      const { encoding, ...rest } = outcome;
      removed.resolve({
        ...rest,
        ...(encoding === "text" || encoding === "base64" ? { encoding } : {}),
        timedOut: false,
      });
      return true;
    },

    pendingCount() {
      return pendingById.size;
    },
  };
}
