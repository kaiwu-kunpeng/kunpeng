import { describe, it, expect, vi } from "vitest";
import { createFsQueue } from "../../src/server/worker/fs-queue.js";
import type { WorkerFsOp } from "../../src/server/worker/tool-surface.js";

const READ: WorkerFsOp = { op: "fs", kind: "read", path: "a.txt" };
const WRITE: WorkerFsOp = { op: "fs", kind: "write", path: "b.txt", content: "hello" };

describe("文件操作队列", () => {
  it("submit 后 take 取到同一条,再 take 为 null", () => {
    const q = createFsQueue();
    const { opId } = q.submit("conv-1", READ);
    const taken = q.take("conv-1");
    expect(taken?.opId).toBe(opId);
    expect(taken?.op).toEqual(READ);
    expect(taken?.conv).toBe("conv-1");
    expect(q.take("conv-1")).toBeNull();
  });

  it("跨会话隔离:别的 conv 取不到", () => {
    const q = createFsQueue();
    q.submit("conv-A", READ);
    expect(q.take("conv-B")).toBeNull();
    expect(q.take("conv-A")).not.toBeNull();
  });

  it("settle 成功后 result 兑现,字段原样", async () => {
    const q = createFsQueue();
    const { opId, result } = q.submit("c", READ);
    q.take("c");
    expect(q.settle(opId, { ok: true, data: "文件内容" })).toBe(true);
    const outcome = await result;
    expect(outcome.ok).toBe(true);
    expect(outcome.data).toBe("文件内容");
    expect(outcome.timedOut).toBe(false);
  });

  it("失败也能 settle,error 原样带回", async () => {
    const q = createFsQueue();
    const { opId, result } = q.submit("c", WRITE);
    expect(q.settle(opId, { ok: false, error: "权限不足" })).toBe(true);
    const outcome = await result;
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe("权限不足");
    expect(outcome.timedOut).toBe(false);
  });

  it("未知 opId 的 settle 返回 false", () => {
    const q = createFsQueue();
    expect(q.settle("nope", { ok: true })).toBe(false);
  });

  it("重复 settle 返回 false", async () => {
    const q = createFsQueue();
    const { opId, result } = q.submit("c", READ);
    expect(q.settle(opId, { ok: true, data: "x" })).toBe(true);
    await result;
    expect(q.settle(opId, { ok: true, data: "y" })).toBe(false);
  });

  it("超时:resolve 为 timedOut 而不是 reject,error 含「超时」", async () => {
    vi.useFakeTimers();
    try {
      const q = createFsQueue();
      const { result } = q.submit("c", READ, { timeoutMs: 1000 });
      vi.advanceTimersByTime(1001);
      const outcome = await result;
      expect(outcome.timedOut).toBe(true);
      expect(outcome.ok).toBe(false);
      expect(String(outcome.error)).toContain("超时");
    } finally {
      vi.useRealTimers();
    }
  });

  it("超时后 settle 返回 false", async () => {
    vi.useFakeTimers();
    try {
      const q = createFsQueue();
      const { opId, result } = q.submit("c", READ, { timeoutMs: 500 });
      vi.advanceTimersByTime(501);
      await result;
      expect(q.settle(opId, { ok: true, data: "迟到的结果" })).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("默认超时是 30 秒量级(不该沿用 exec 的 10 分钟)", async () => {
    vi.useFakeTimers();
    try {
      const q = createFsQueue();
      const { result } = q.submit("c", READ);
      vi.advanceTimersByTime(30_001);
      expect((await result).timedOut).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pendingCount 随提交与结束增减", async () => {
    const q = createFsQueue();
    expect(q.pendingCount()).toBe(0);
    const a = q.submit("c", READ);
    const b = q.submit("c", WRITE);
    expect(q.pendingCount()).toBe(2);
    q.settle(a.opId, { ok: true });
    await a.result;
    expect(q.pendingCount()).toBe(1);
    q.settle(b.opId, { ok: true });
    await b.result;
    expect(q.pendingCount()).toBe(0);
  });

  it("两个实例互不影响(不得用模块级全局)", () => {
    const q1 = createFsQueue();
    const q2 = createFsQueue();
    q1.submit("c", READ);
    expect(q1.pendingCount()).toBe(1);
    expect(q2.pendingCount()).toBe(0);
    expect(q2.take("c")).toBeNull();
  });

  it("同一会话多条按提交顺序取出", () => {
    const q = createFsQueue();
    q.submit("c", READ);
    q.submit("c", WRITE);
    expect(q.take("c")?.op.kind).toBe("read");
    expect(q.take("c")?.op.kind).toBe("write");
  });

  it("opId 不重复", () => {
    const q = createFsQueue();
    const ids = new Set<string>();
    for (let i = 0; i < 50; i += 1) ids.add(q.submit("c", READ).opId);
    expect(ids.size).toBe(50);
  });

  it("submittedAt 用注入的 now", () => {
    const q = createFsQueue({ now: () => 12345 });
    q.submit("c", READ);
    expect(q.take("c")?.submittedAt).toBe(12345);
  });
});