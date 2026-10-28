import { describe, expect, test, afterEach } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import {
  nextBackoffMs,
  createWorkerClient,
  type WorkerClient,
  type WorkerClientState,
} from "../../src/server/worker/worker-client.js";
import { attachWorkerWebSocket, WORKER_WS_PATH } from "../../src/server/worker/worker-endpoint.js";
import { signWorkerToken, newMachineId } from "../../src/server/worker/worker-token.js";

const SECRET = "client-test-secret";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) {
    try { await fn(); } catch { /* 清理尽力而为 */ }
  }
});

async function startHost(): Promise<{
  port: number;
  endpoint: ReturnType<typeof attachWorkerWebSocket>;
  server: Server;
}> {
  const server = http.createServer((_req, res) => res.end("ok"));
  const endpoint = attachWorkerWebSocket(server, { resolveSecret: async () => SECRET });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (typeof addr === "string" || addr === null) throw new Error("拿不到端口");
  cleanups.push(() => { endpoint.close(); server.close(); });
  return { port: addr.port, endpoint, server };
}

function makeClient(port: number, extra: Record<string, unknown> = {}): WorkerClient {
  const client = createWorkerClient({
    url: `ws://127.0.0.1:${port}${WORKER_WS_PATH}`,
    token: signWorkerToken("acct-1", newMachineId(), SECRET, Date.now()),
    machineName: "测试工作机",
    root: "/tmp",
    backoff: { baseMs: 30, maxMs: 120 },
    ...extra,
  });
  cleanups.push(() => client.stop());
  return client;
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("等待条件超时");
}

describe("退避 nextBackoffMs", () => {
  test("恒为正整数且不超上限", () => {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const value = nextBackoffMs(attempt, { baseMs: 100, maxMs: 5000 });
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(5000);
    }
  });

  test("抖动落在 [half, full] 区间", () => {
    for (const random of [0, 0.5, 0.999]) {
      const value = nextBackoffMs(3, { baseMs: 100, maxMs: 10_000, random: () => random });
      expect(value).toBeGreaterThanOrEqual(200);
      expect(value).toBeLessThanOrEqual(400);
    }
  });

  test("random 取 1 时等于该次的完整退避", () => {
    expect(nextBackoffMs(1, { baseMs: 100, maxMs: 10_000, random: () => 1 })).toBe(100);
    expect(nextBackoffMs(2, { baseMs: 100, maxMs: 10_000, random: () => 1 })).toBe(200);
    expect(nextBackoffMs(4, { baseMs: 100, maxMs: 10_000, random: () => 1 })).toBe(800);
  });

  test("按上限截断", () => {
    expect(nextBackoffMs(30, { baseMs: 100, maxMs: 1000, random: () => 1 })).toBe(1000);
  });

  test("attempt <= 0 按 1 处理", () => {
    const one = nextBackoffMs(1, { baseMs: 100, maxMs: 10_000, random: () => 1 });
    expect(nextBackoffMs(0, { baseMs: 100, maxMs: 10_000, random: () => 1 })).toBe(one);
    expect(nextBackoffMs(-5, { baseMs: 100, maxMs: 10_000, random: () => 1 })).toBe(one);
  });

  test("截断前单调不减", () => {
    let prev = 0;
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const value = nextBackoffMs(attempt, { baseMs: 10, maxMs: 10_000, random: () => 1 });
      expect(value).toBeGreaterThanOrEqual(prev);
      prev = value;
    }
  });
});

describe("工作机客户端 · 端到端", () => {
  test("连上后主机 registry 里出现这台机器", async () => {
    const host = await startHost();
    const client = makeClient(host.port);
    client.start();
    await waitFor(() => host.endpoint.registry.listByAccount("acct-1").length === 1);
    const conn = host.endpoint.registry.listByAccount("acct-1")[0];
    expect(conn.machineName).toBe("测试工作机");
    expect(conn.root).toBe("/tmp");
    expect(client.state()).toBe("online");
  }, 20_000);

  test("主机派命令 → 流式输出 + 正确退出码", async () => {
    const host = await startHost();
    const client = makeClient(host.port);
    client.start();
    await waitFor(() => host.endpoint.registry.listByAccount("acct-1").length === 1);
    const conn = host.endpoint.registry.listByAccount("acct-1")[0];

    const { execId, result } = host.endpoint.execQueue.submit("conv-1", "echo 甲 && (exit 5)");
    const chunks: string[] = [];
    host.endpoint.execQueue.onChunk(execId, (_stream, data) => chunks.push(data));
    host.endpoint.dispatchExec(conn.connId, host.endpoint.execQueue.take("conv-1") as never, 20_000);

    const outcome = await result;
    expect(outcome.stdout).toContain("甲");
    expect(outcome.exitCode).toBe(5);
    expect(outcome.timedOut).toBe(false);
    expect(chunks.join("")).toContain("甲");
  }, 20_000);

  test("串行:两条命令的输出不交叉且顺序正确", async () => {
    const host = await startHost();
    const client = makeClient(host.port);
    client.start();
    await waitFor(() => host.endpoint.registry.listByAccount("acct-1").length === 1);
    const conn = host.endpoint.registry.listByAccount("acct-1")[0];

    const a = host.endpoint.execQueue.submit("conv-a", "echo 一号开始; sleep 0.5; echo 一号结束");
    host.endpoint.dispatchExec(conn.connId, host.endpoint.execQueue.take("conv-a") as never, 20_000);
    const b = host.endpoint.execQueue.submit("conv-b", "echo 二号");
    host.endpoint.dispatchExec(conn.connId, host.endpoint.execQueue.take("conv-b") as never, 20_000);

    const [ra, rb] = await Promise.all([a.result, b.result]);
    expect(ra.stdout).toContain("一号开始");
    expect(ra.stdout).toContain("一号结束");
    expect(ra.stdout).not.toContain("二号");
    expect(rb.stdout).toContain("二号");
    expect(rb.stdout).not.toContain("一号");
  }, 25_000);

  test("cd 在多条命令间保持(常驻 shell)", async () => {
    const host = await startHost();
    const client = makeClient(host.port);
    client.start();
    await waitFor(() => host.endpoint.registry.listByAccount("acct-1").length === 1);
    const conn = host.endpoint.registry.listByAccount("acct-1")[0];

    const a = host.endpoint.execQueue.submit("c", "cd /");
    host.endpoint.dispatchExec(conn.connId, host.endpoint.execQueue.take("c") as never, 20_000);
    await a.result;
    const b = host.endpoint.execQueue.submit("c", "pwd");
    host.endpoint.dispatchExec(conn.connId, host.endpoint.execQueue.take("c") as never, 20_000);
    expect((await b.result).stdout.trim()).toBe("/");
  }, 25_000);

  test("shell 执行抛错时仍然发 done,主机不会挂死", async () => {
    const host = await startHost();
    const client = makeClient(host.port, {
      shellFactory: () => ({
        run: () => Promise.reject(new Error("shell 炸了")),
        close: () => {},
        isAlive: () => false,
      }),
    });
    client.start();
    await waitFor(() => host.endpoint.registry.listByAccount("acct-1").length === 1);
    const conn = host.endpoint.registry.listByAccount("acct-1")[0];

    const { result } = host.endpoint.execQueue.submit("conv-x", "随便什么命令");
    host.endpoint.dispatchExec(conn.connId, host.endpoint.execQueue.take("conv-x") as never, 20_000);
    const outcome = await result;
    expect(outcome.timedOut).toBe(false);
    expect(outcome.exitCode).not.toBeNull();
  }, 20_000);
});

describe("工作机客户端 · 重连与停止", () => {
  test("断线后自动重连,重连成功 attempts 归零", async () => {
    const host = await startHost();
    const states: WorkerClientState[] = [];
    const client = makeClient(host.port, { onStateChange: (s: WorkerClientState) => states.push(s) });
    client.start();
    await waitFor(() => host.endpoint.registry.listByAccount("acct-1").length === 1);

    host.endpoint.close();
    await waitFor(() => client.state() === "reconnecting" || client.state() === "connecting", 8000);

    const revived = attachWorkerWebSocket(host.server, { resolveSecret: async () => SECRET });
    cleanups.push(() => revived.close());
    await waitFor(() => revived.registry.listByAccount("acct-1").length === 1, 15_000);
    expect(client.state()).toBe("online");
    expect(client.attempts()).toBe(0);
    expect(states).toContain("online");
  }, 30_000);

  test("stop() 后不再重连", async () => {
    const host = await startHost();
    const client = makeClient(host.port);
    client.start();
    await waitFor(() => host.endpoint.registry.listByAccount("acct-1").length === 1);
    await client.stop();
    expect(client.state()).toBe("stopped");
    await new Promise((r) => setTimeout(r, 400));
    expect(client.state()).toBe("stopped");
    expect(host.endpoint.registry.listByAccount("acct-1").length).toBe(0);
  }, 20_000);

  test("stop() 可重复调用且不抛", async () => {
    const host = await startHost();
    const client = makeClient(host.port);
    client.start();
    await client.stop();
    await expect(client.stop()).resolves.toBeUndefined();
  }, 20_000);

  test("重复 start() 幂等,不会连出两条", async () => {
    const host = await startHost();
    const client = makeClient(host.port);
    client.start();
    client.start();
    client.start();
    await waitFor(() => host.endpoint.registry.listByAccount("acct-1").length === 1);
    await new Promise((r) => setTimeout(r, 400));
    expect(host.endpoint.registry.listByAccount("acct-1").length).toBe(1);
  }, 20_000);

  test("token 不出现在状态回调里", async () => {
    const host = await startHost();
    const seen: string[] = [];
    const client = makeClient(host.port, {
      onStateChange: (s: WorkerClientState) => seen.push(String(s)),
    });
    client.start();
    await waitFor(() => client.state() === "online");
    expect(seen.join("|")).not.toContain("w1.");
  }, 20_000);

  test("onStateChange 抛异常不影响客户端", async () => {
    const host = await startHost();
    const client = makeClient(host.port, {
      onStateChange: () => { throw new Error("回调炸了"); },
    });
    client.start();
    await waitFor(() => host.endpoint.registry.listByAccount("acct-1").length === 1);
    expect(client.state()).toBe("online");
  }, 20_000);
});