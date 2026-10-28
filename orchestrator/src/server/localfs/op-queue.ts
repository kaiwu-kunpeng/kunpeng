import { randomUUID } from "node:crypto";

import type { LocalFsOp, LocalFsResult } from "./types.js";

export interface OpQueue {
  enqueue(
    conv: string,
    op: Omit<LocalFsOp, "opId" | "conv">,
    timeoutMs?: number,
    noListenerMs?: number,
  ): Promise<LocalFsResult>;
  markPolled?(conv: string): void;
  take(conv: string): LocalFsOp | null;
  resolve(opId: string, result: LocalFsResult, opts?: { conv?: string }): boolean;
}

export interface PollAwareOpQueue extends OpQueue {
  markPolled(conv: string): void;
}

interface PendingOp {
  op: LocalFsOp;
  taken: boolean;
  enqueuedAt: number;
  timeoutTimer: NodeJS.Timeout;
  noListenerTimer: NodeJS.Timeout;
  resolve: (result: LocalFsResult) => void;
  reject: (error: Error) => void;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_NO_LISTENER_MS = 8_000;
const LOCALFS_META_PREFIX = "__KP_LOCALFS_META__";

export function resolveNoListenerMs(hasAuthz: boolean): number {
  return hasAuthz ? 65_000 : DEFAULT_NO_LISTENER_MS;
}

function restoreResultMetadata(result: LocalFsResult): LocalFsResult {
  if (!result.ok || !result.error?.startsWith(LOCALFS_META_PREFIX)) return result;
  try {
    const parsed = JSON.parse(result.error.slice(LOCALFS_META_PREFIX.length)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return result;
    const metadata = parsed as { encoding?: unknown; truncated?: unknown };
    const restored: LocalFsResult = { opId: result.opId, ok: true, ...(result.data === undefined ? {} : { data: result.data }) };
    let recognized = false;
    if (metadata.encoding === "text" || metadata.encoding === "base64") {
      restored.encoding = metadata.encoding;
      recognized = true;
    }
    if (metadata.truncated === true) {
      restored.truncated = true;
      recognized = true;
    }
    return recognized ? restored : result;
  } catch {
    return result;
  }
}

export function createOpQueue(opts?: { hasAuthz?: (conv: string) => boolean }): PollAwareOpQueue {
  const pendingByOpId = new Map<string, PendingOp>();
  const opIdsByConv = new Map<string, string[]>();
  const lastPollAtByConv = new Map<string, number>();

  function remove(opId: string): PendingOp | undefined {
    const pending = pendingByOpId.get(opId);
    if (!pending) return undefined;

    pendingByOpId.delete(opId);
    const queue = opIdsByConv.get(pending.op.conv);
    if (queue) {
      const index = queue.indexOf(opId);
      if (index >= 0) queue.splice(index, 1);
      if (queue.length === 0) opIdsByConv.delete(pending.op.conv);
    }
    clearTimeout(pending.timeoutTimer);
    clearTimeout(pending.noListenerTimer);
    return pending;
  }

  return {
    enqueue(conv, op, timeoutMs = DEFAULT_TIMEOUT_MS, noListenerMs?: number) {
      const opId = `localfs-${randomUUID()}`;
      const localFsOp: LocalFsOp = { ...op, opId, conv };
      const enqueuedAt = Date.now();
      let hasAuthz = false;
      try {
        hasAuthz = opts?.hasAuthz?.(conv) === true;
      } catch {
        hasAuthz = false;
      }
      const resolvedNoListenerMs = noListenerMs ?? resolveNoListenerMs(hasAuthz);

      return new Promise<LocalFsResult>((resolve, reject) => {
        const timeoutTimer = setTimeout(() => {
          const removed = remove(opId);
          if (!removed) return;
          removed.reject(new Error("本地目录 120s 未响应——文件较大时请保持对话标签页在前台;或目录授权已失效,请回 cockpit 确认 📁 chip 在线"));
        }, timeoutMs);
        const noListenerTimer = setTimeout(() => {
          const pending = pendingByOpId.get(opId);
          if (!pending || pending.taken) return;
          if ((lastPollAtByConv.get(conv) ?? 0) >= pending.enqueuedAt) return;

          const removed = remove(opId);
          if (!removed) return;
          removed.reject(new Error(hasAuthz
            ? "本地目录已授权,但对话页未在轮询(可能在后台被节流或已断开)——请切回对话标签页并保持前台后重试"
            : "本地目录未授权或需恢复——请回对话页点 📁 授权/恢复本地目录后重试"));
        }, resolvedNoListenerMs);

        pendingByOpId.set(opId, {
          op: localFsOp,
          taken: false,
          enqueuedAt,
          timeoutTimer,
          noListenerTimer,
          resolve,
          reject,
        });

        const queue = opIdsByConv.get(conv) ?? [];
        queue.push(opId);
        opIdsByConv.set(conv, queue);
      });
    },

    markPolled(conv) {
      lastPollAtByConv.set(conv, Date.now());
    },

    take(conv) {
      const queue = opIdsByConv.get(conv);
      if (!queue) return null;

      for (const opId of queue) {
        const pending = pendingByOpId.get(opId);
        if (pending && !pending.taken) {
          pending.taken = true;
          clearTimeout(pending.noListenerTimer);
          return pending.op;
        }
      }
      return null;
    },

    resolve(opId, result, opts) {
      const pending = pendingByOpId.get(opId);
      if (opts?.conv && pending && pending.op.conv !== opts.conv) return false;
      const removed = remove(opId);
      if (!removed) return false;
      removed.resolve(restoreResultMetadata(result));
      return true;
    },
  };
}
