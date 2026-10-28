import { describe, it, expect, vi } from "vitest";
import { createExecQueue } from "../../src/server/worker/exec-queue.js";

describe("exec queue", () => {
  it("submit 后 take 取到同一条,再 take 为 null", () => {
    const q = createExecQueue();
    const { execId } = q.submit("conv-1", "echo hi");
    const taken = q.take("conv-1");
    expect(taken?.execId).toBe(execId);
    expect(taken?.command).toBe("echo hi");
    expect(taken?.conv).toBe("conv-1");
    expect(q.take("conv-1")).toBeNull();
  });

  it("跨会话隔离:别的 conv 取不到", () => {
    const q = createExecQueue();
    q.submit("conv-A", "echo a");
    expect(q.take("conv-B")).toBeNull();
    expect(q.take("conv-A")).not.toBeNull();
  });

  it("分片累积后 complete,输出原样且顺序不乱", async () => {
    const q = createExecQueue();
    const { execId, result } = q.submit("c", "build");
    q.take("c");
    expect(q.pushChunk(execId, "stdout", "one ")).toBe(true);
    expect(q.pushChunk(execId, "stdout", "two ")).toBe(true);
    expect(q.pushChunk(execId, "stderr", "warn")).toBe(true);
    expect(q.complete(execId, { exitCode: 0 })).toBe(true);
    const outcome = await result;
    expect(outcome.stdout).toBe("one two ");
    expect(outcome.stderr).toBe("warn");
    expect(outcome.exitCode).toBe(0);
    expect(outcome.timedOut).toBe(false);
  });

  it("complete 后再 pushChunk 返回 false", async () => {
    const q = createExecQueue();
    const { execId, result } = q.submit("c", "x");
    q.complete(execId, { exitCode: 0 });
    await result;
    expect(q.pushChunk(execId, "stdout", "late")).toBe(false);
    expect(q.complete(execId, { exitCode: 0 })).toBe(false);
  });

  it("未知 execId 的 pushChunk 与 complete 都返回 false", () => {
    const q = createExecQueue();
    expect(q.pushChunk("nope", "stdout", "x")).toBe(false);
    expect(q.complete("nope", { exitCode: 0 })).toBe(false);
  });

  it("truncated 标志透传", async () => {
    const q = createExecQueue();
    const { execId, result } = q.submit("c", "big");
    q.pushChunk(execId, "stdout", "partial");
    q.complete(execId, { exitCode: 0, truncated: true });
    const outcome = await result;
    expect(outcome.truncated).toBe(true);
    expect(outcome.stdout).toBe("partial");
  });

  it("超时:resolve 为 timedOut、exitCode 为 null,且保留已收到的输出", async () => {
    vi.useFakeTimers();
    try {
      const q = createExecQueue();
      const { execId, result } = q.submit("c", "sleep 999", { timeoutMs: 1000 });
      q.pushChunk(execId, "stdout", "started");
      vi.advanceTimersByTime(1001);
      const outcome = await result;
      expect(outcome.timedOut).toBe(true);
      expect(outcome.exitCode).toBeNull();
      expect(outcome.stdout).toBe("started");
    } finally {
      vi.useRealTimers();
    }
  });

  it("超时后 pushChunk 与 complete 都返回 false", async () => {
    vi.useFakeTimers();
    try {
      const q = createExecQueue();
      const { execId, result } = q.submit("c", "hang", { timeoutMs: 500 });
      vi.advanceTimersByTime(501);
      await result;
      expect(q.pushChunk(execId, "stdout", "zombie")).toBe(false);
      expect(q.complete(execId, { exitCode: 0 })).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("onChunk 按顺序收到分片,取消订阅后不再收到", () => {
    const q = createExecQueue();
    const { execId } = q.submit("c", "x");
    const seen: string[] = [];
    const off = q.onChunk(execId, (stream, data) => { seen.push(`${stream}:${data}`); });
    q.pushChunk(execId, "stdout", "a");
    q.pushChunk(execId, "stderr", "b");
    off();
    q.pushChunk(execId, "stdout", "c");
    expect(seen).toEqual(["stdout:a", "stderr:b"]);
  });

  it("pendingCount 随提交与结束增减", async () => {
    const q = createExecQueue();
    expect(q.pendingCount()).toBe(0);
    const a = q.submit("c", "one");
    const b = q.submit("c", "two");
    expect(q.pendingCount()).toBe(2);
    q.complete(a.execId, { exitCode: 0 });
    await a.result;
    expect(q.pendingCount()).toBe(1);
    q.complete(b.execId, { exitCode: 0 });
    await b.result;
    expect(q.pendingCount()).toBe(0);
  });

  it("两个队列实例互不影响(不得用模块级全局)", () => {
    const q1 = createExecQueue();
    const q2 = createExecQueue();
    q1.submit("c", "x");
    expect(q1.pendingCount()).toBe(1);
    expect(q2.pendingCount()).toBe(0);
    expect(q2.take("c")).toBeNull();
  });

  it("同一会话多条命令按提交顺序取出", () => {
    const q = createExecQueue();
    q.submit("c", "first");
    q.submit("c", "second");
    expect(q.take("c")?.command).toBe("first");
    expect(q.take("c")?.command).toBe("second");
  });
});