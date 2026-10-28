import { describe, expect, test, afterEach, vi } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachWorkerWebSocket, WORKER_WS_PATH } from "../../src/server/worker/worker-endpoint.js";
import { createWorkerClient, type WorkerClient } from "../../src/server/worker/worker-client.js";
import { signWorkerToken, newMachineId } from "../../src/server/worker/worker-token.js";
import { createExecQueue } from "../../src/server/worker/exec-queue.js";

const SECRET = "disconnect-secret";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) {
    try { await fn(); } catch { /* 清理尽力而为 */ }
  }
});

async function joinOne(account: string): Promise<{
  endpoint: ReturnType<typeof attachWorkerWebSocket>;
  client: WorkerClient;
  connId: string;
  url: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "kp-disc-"));
  const server: Server = http.createServer((_req, res) => res.end("ok"));
  const endpoint = attachWorkerWebSocket(server, { resolveSecret: async () => SECRET });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (typeof addr === "string" || addr === null) throw new Error("拿不到端口");
  const url = `ws://127.0.0.1:${addr.port}${WORKER_WS_PATH}`;
  const client = createWorkerClient({
    url,
    token: signWorkerToken(account, newMachineId(), SECRET, Date.now()),
    machineName: "断线测试机",
    root,
  });
  cleanups.push(() => client.stop());
  cleanups.push(() => { endpoint.close(); server.close(); });
  client.start();
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && endpoint.registry.listByAccount(account).length === 0) {
    await new Promise((r) => setTimeout(r, 25));
  }
  const conn = endpoint.registry.listByAccount(account)[0];
  if (!conn) throw new Error("没连上");
  return { endpoint, client, connId: conn.connId, url };
}

function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), ms)),
  ]);
}

describe("exec-queue 的 abort", () => {
  test("abort 用已累积的输出 resolve,exitCode 为 null", async () => {
    const q = createExecQueue();
    const { execId, result } = q.submit("c", "x");
    q.take("c");
    q.pushChunk(execId, "stdout", "已经收到的输出");
    expect(q.abort(execId, "工作机连接已断开")).toBe(true);
    const outcome = await result;
    expect(outcome.stdout).toBe("已经收到的输出");
    expect(outcome.exitCode).toBeNull();
    expect(outcome.timedOut).toBe(false);
    expect(outcome.stderr).toContain("断开");
  });

  test("abort 后 pushChunk / complete / abort 都返回 false", async () => {
    const q = createExecQueue();
    const { execId, result } = q.submit("c", "x");
    q.abort(execId, "断了");
    await result;
    expect(q.pushChunk(execId, "stdout", "迟到")).toBe(false);
    expect(q.complete(execId, { exitCode: 0 })).toBe(false);
    expect(q.abort(execId, "再断一次")).toBe(false);
  });

  test("abort 未知 execId 返回 false", () => {
    expect(createExecQueue().abort("没有这个", "x")).toBe(false);
  });

  test("已 complete 的再 abort 返回 false", async () => {
    const q = createExecQueue();
    const { execId, result } = q.submit("c", "x");
    q.complete(execId, { exitCode: 0 });
    await result;
    expect(q.abort(execId, "晚了")).toBe(false);
  });

  test("已超时的再 abort 返回 false", async () => {
    vi.useFakeTimers();
    try {
      const q = createExecQueue();
      const { execId, result } = q.submit("c", "x", { timeoutMs: 100 });
      vi.advanceTimersByTime(101);
      await result;
      expect(q.abort(execId, "更晚")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("pendingCount 相应减一", async () => {
    const q = createExecQueue();
    const a = q.submit("c", "x");
    q.submit("c", "y");
    expect(q.pendingCount()).toBe(2);
    q.abort(a.execId, "断");
    await a.result;
    expect(q.pendingCount()).toBe(1);
  });

  test("超时语义没被改坏(仍 resolve 且 timedOut 为真)", async () => {
    vi.useFakeTimers();
    try {
      const q = createExecQueue();
      const { result } = q.submit("c", "x", { timeoutMs: 50 });
      vi.advanceTimersByTime(51);
      const outcome = await result;
      expect(outcome.timedOut).toBe(true);
      expect(outcome.exitCode).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("断线立刻收尾", () => {
  test("在飞的 exec 在 1 秒内被收尾,不是等 10 分钟", async () => {
    const ctx = await joinOne("acct-1");
    const { execId, result } = ctx.endpoint.execQueue.submit("c", "sleep 30", { timeoutMs: 600_000 });
    ctx.endpoint.dispatchExec(ctx.connId, ctx.endpoint.execQueue.take("c") as never, 600_000);
    await new Promise((r) => setTimeout(r, 300));
    ctx.endpoint.execQueue.pushChunk(execId, "stdout", "断线前的输出");
    await ctx.client.stop();
    expect(await settledWithin(result, 3000), "断线后应当立刻收尾").toBe(true);
    const outcome = await result;
    expect(outcome.exitCode).toBeNull();
    expect(outcome.timedOut).toBe(false);
    expect(outcome.stderr).toContain("断开");
    expect(outcome.stdout).toContain("断线前的输出");
  }, 30_000);

  test("在飞的 fs 操作同样立刻收尾", async () => {
    const ctx = await joinOne("acct-2");
    const { result } = ctx.endpoint.fsQueue.submit(
      "c", { op: "fs", kind: "read", path: "任意.txt" }, { timeoutMs: 30_000 },
    );
    ctx.endpoint.dispatchFs(ctx.connId, ctx.endpoint.fsQueue.take("c") as never);
    await new Promise((r) => setTimeout(r, 100));
    await ctx.client.stop();
    expect(await settledWithin(result, 3000)).toBe(true);
    const outcome = await result;
    expect(outcome.ok).toBe(false);
    expect(String(outcome.error)).toContain("断开");
  }, 30_000);

  test("端点 close() 时同样收尾", async () => {
    const ctx = await joinOne("acct-3");
    const { result } = ctx.endpoint.execQueue.submit("c", "sleep 30", { timeoutMs: 600_000 });
    ctx.endpoint.dispatchExec(ctx.connId, ctx.endpoint.execQueue.take("c") as never, 600_000);
    await new Promise((r) => setTimeout(r, 200));
    ctx.endpoint.close();
    expect(await settledWithin(result, 3000)).toBe(true);
  }, 30_000);

  test("幂等:重复触发断线不抛、不重复 resolve", async () => {
    const ctx = await joinOne("acct-4");
    const { result } = ctx.endpoint.execQueue.submit("c", "sleep 30", { timeoutMs: 600_000 });
    ctx.endpoint.dispatchExec(ctx.connId, ctx.endpoint.execQueue.take("c") as never, 600_000);
    await new Promise((r) => setTimeout(r, 200));
    await ctx.client.stop();
    expect(() => { ctx.endpoint.close(); ctx.endpoint.close(); }).not.toThrow();
    await result;
  }, 30_000);
});

describe("跨机隔离不能被断线破坏", () => {
  test("甲断线不影响乙在飞的操作", async () => {
    const root = await mkdtemp(join(tmpdir(), "kp-disc-multi-"));
    const server: Server = http.createServer((_req, res) => res.end("ok"));
    const endpoint = attachWorkerWebSocket(server, { resolveSecret: async () => SECRET });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (typeof addr === "string" || addr === null) throw new Error("拿不到端口");
    const url = `ws://127.0.0.1:${addr.port}${WORKER_WS_PATH}`;
    cleanups.push(() => { endpoint.close(); server.close(); });

    const mk = (acct: string): WorkerClient => {
      const c = createWorkerClient({
        url, token: signWorkerToken(acct, newMachineId(), SECRET, Date.now()),
        machineName: acct, root,
      });
      cleanups.push(() => c.stop());
      c.start();
      return c;
    };
    const a = mk("acct-A");
    const b = mk("acct-B");
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline
      && (endpoint.registry.listByAccount("acct-A").length === 0
        || endpoint.registry.listByAccount("acct-B").length === 0)) {
      await new Promise((r) => setTimeout(r, 25));
    }
    const connB = endpoint.registry.listByAccount("acct-B")[0];
    const { result: rb } = endpoint.execQueue.submit("cb", "sleep 2", { timeoutMs: 60_000 });
    endpoint.dispatchExec(connB.connId, endpoint.execQueue.take("cb") as never, 60_000);
    await new Promise((r) => setTimeout(r, 200));

    await a.stop();
    await new Promise((r) => setTimeout(r, 400));
    expect(await settledWithin(rb, 400), "乙的操作不该被甲断线波及").toBe(false);

    const outcome = await rb;
    expect(outcome.exitCode).toBe(0);
    void b;
  }, 40_000);
});

describe("既有行为一条不破", () => {
  test("正常 exec 仍然拿到真实退出码", async () => {
    const ctx = await joinOne("acct-ok");
    const { result } = ctx.endpoint.execQueue.submit("c", "echo 正常 && (exit 7)");
    ctx.endpoint.dispatchExec(ctx.connId, ctx.endpoint.execQueue.take("c") as never, 30_000);
    const outcome = await result;
    expect(outcome.stdout).toContain("正常");
    expect(outcome.exitCode).toBe(7);
    expect(outcome.stderr).not.toContain("断开");
  }, 30_000);
});