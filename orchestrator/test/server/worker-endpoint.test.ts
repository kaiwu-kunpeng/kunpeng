import { describe, expect, test, afterEach } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import WebSocket from "ws";
import {
  attachWorkerWebSocket,
  WORKER_WS_PATH,
} from "../../src/server/worker/worker-endpoint.js";
import { signWorkerToken, WORKER_PROTOCOL_VERSION } from "../../src/server/worker/worker-token.js";

const SECRET = "test-secret-abc";
const NOW = 1_700_000_000_000;

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) {
    try { fn(); } catch { /* 清理尽力而为 */ }
  }
});

async function startServer(overrides: Record<string, unknown> = {}): Promise<{
  port: number;
  endpoint: ReturnType<typeof attachWorkerWebSocket>;
  server: Server;
}> {
  const server = http.createServer((_req, res) => res.end("ok"));
  const endpoint = attachWorkerWebSocket(server, {
    resolveSecret: async () => SECRET,
    now: () => NOW,
    ...overrides,
  } as never);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (typeof addr === "string" || addr === null) throw new Error("拿不到端口");
  cleanups.push(() => { endpoint.close(); server.close(); });
  return { port: addr.port, endpoint, server };
}

interface ConnectResult {
  ws?: WebSocket;
  status?: number;
  error?: string;
}

function connect(
  port: number,
  headers: Record<string, string>,
): Promise<ConnectResult> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${WORKER_WS_PATH}`, { headers });
    let settled = false;
    const done = (r: ConnectResult): void => { if (!settled) { settled = true; resolve(r); } };
    ws.on("open", () => done({ ws }));
    ws.on("unexpected-response", (_req, res) => { res.resume(); done({ status: res.statusCode }); });
    ws.on("error", (err: Error) => done({ error: err.message }));
    setTimeout(() => done({ error: "timeout" }), 3000);
  });
}

function goodHeaders(accountId = "acct-1", machineId = "machine-1"): Record<string, string> {
  return {
    Authorization: `Bearer ${signWorkerToken(accountId, machineId, SECRET, NOW)}`,
    "X-Kunpeng-Worker-Protocol": String(WORKER_PROTOCOL_VERSION),
  };
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("等消息超时")), 3000);
    ws.once("message", (raw: Buffer) => {
      clearTimeout(timer);
      resolve(JSON.parse(raw.toString("utf8")) as Record<string, unknown>);
    });
  });
}

describe("worker 端点 · 握手鉴权", () => {
  test("合法 token + 正确协议 + 无 Origin → 升级成功并收到 ready", async () => {
    const { port } = await startServer();
    const r = await connect(port, goodHeaders());
    expect(r.ws).toBeDefined();
    const msg = await nextMessage(r.ws as WebSocket);
    expect(msg.type).toBe("ready");
    expect(typeof msg.connId).toBe("string");
    (r.ws as WebSocket).close();
  });

  test("带 Origin 头 → 403(浏览器不得冒充工作机)", async () => {
    const { port } = await startServer();
    const r = await connect(port, { ...goodHeaders(), Origin: "https://evil.example.com" });
    expect(r.status).toBe(403);
  });

  test("同源的 Origin 也照拒(判据是有没有 Origin,不是它是什么)", async () => {
    const { port } = await startServer();
    const r = await connect(port, { ...goodHeaders(), Origin: `http://127.0.0.1:${port}` });
    expect(r.status).toBe(403);
  });

  test("无 Authorization → 401", async () => {
    const { port } = await startServer();
    const r = await connect(port, { "X-Kunpeng-Worker-Protocol": String(WORKER_PROTOCOL_VERSION) });
    expect(r.status).toBe(401);
  });

  test("非 Bearer 前缀 → 401", async () => {
    const { port } = await startServer();
    const r = await connect(port, {
      Authorization: signWorkerToken("a", "m", SECRET, NOW),
      "X-Kunpeng-Worker-Protocol": String(WORKER_PROTOCOL_VERSION),
    });
    expect(r.status).toBe(401);
  });

  test("伪造签名 → 401", async () => {
    const { port } = await startServer();
    const bad = signWorkerToken("acct-1", "machine-1", "wrong-secret", NOW);
    const r = await connect(port, {
      Authorization: `Bearer ${bad}`,
      "X-Kunpeng-Worker-Protocol": String(WORKER_PROTOCOL_VERSION),
    });
    expect(r.status).toBe(401);
  });

  test("篡改 accountId 后签名失配 → 401", async () => {
    const { port } = await startServer();
    const parts = signWorkerToken("acct-1", "machine-1", SECRET, NOW).split(".");
    parts[1] = "acct-evil";
    const r = await connect(port, {
      Authorization: `Bearer ${parts.join(".")}`,
      "X-Kunpeng-Worker-Protocol": String(WORKER_PROTOCOL_VERSION),
    });
    expect(r.status).toBe(401);
  });

  test("过期 token → 401", async () => {
    const { port } = await startServer({ maxTokenAgeMs: 1000 });
    const old = signWorkerToken("acct-1", "machine-1", SECRET, NOW - 5000);
    const r = await connect(port, {
      Authorization: `Bearer ${old}`,
      "X-Kunpeng-Worker-Protocol": String(WORKER_PROTOCOL_VERSION),
    });
    expect(r.status).toBe(401);
  });

  test("未配置密钥 → 503 而不是放行(fail-closed)", async () => {
    const { port } = await startServer({ resolveSecret: async () => null });
    const r = await connect(port, goodHeaders());
    expect(r.status).toBe(503);
  });

  test("resolveSecret 抛错 → 503,异常不逃逸", async () => {
    const { port } = await startServer({ resolveSecret: async () => { throw new Error("读密钥炸了"); } });
    const r = await connect(port, goodHeaders());
    expect(r.status).toBe(503);
  });

  test("协议版本不符 → 426", async () => {
    const { port } = await startServer();
    const r = await connect(port, {
      Authorization: `Bearer ${signWorkerToken("acct-1", "machine-1", SECRET, NOW)}`,
      "X-Kunpeng-Worker-Protocol": String(WORKER_PROTOCOL_VERSION + 99),
    });
    expect(r.status).toBe(426);
  });

  test("缺协议头 → 426", async () => {
    const { port } = await startServer();
    const r = await connect(port, {
      Authorization: `Bearer ${signWorkerToken("acct-1", "machine-1", SECRET, NOW)}`,
    });
    expect(r.status).toBe(426);
  });
});

describe("worker 端点 · 注册与生命周期", () => {
  test("hello 之后进 registry,身份取自 token 而非 hello 内容", async () => {
    const { port, endpoint } = await startServer();
    const r = await connect(port, goodHeaders("acct-real", "machine-real"));
    const ws = r.ws as WebSocket;
    await nextMessage(ws);
    ws.send(JSON.stringify({
      type: "hello",
      machineName: "我的出差本",
      root: "/Users/me/code",
      accountId: "acct-forged",
      machineId: "machine-forged",
    }));
    await new Promise((res) => setTimeout(res, 200));
    const conns = endpoint.registry.listByAccount("acct-real");
    expect(conns.length).toBe(1);
    expect(conns[0].machineId).toBe("machine-real");
    expect(conns[0].machineName).toBe("我的出差本");
    expect(conns[0].root).toBe("/Users/me/code");
    expect(endpoint.registry.listByAccount("acct-forged").length).toBe(0);
    ws.close();
  });

  test("hello 之前不进 registry", async () => {
    const { port, endpoint } = await startServer();
    const r = await connect(port, goodHeaders());
    await nextMessage(r.ws as WebSocket);
    expect(endpoint.registry.size()).toBe(0);
    (r.ws as WebSocket).close();
  });

  test("socket 关闭后从 registry 摘除", async () => {
    const { port, endpoint } = await startServer();
    const r = await connect(port, goodHeaders("acct-x", "machine-x"));
    const ws = r.ws as WebSocket;
    await nextMessage(ws);
    ws.send(JSON.stringify({ type: "hello", machineName: "m", root: "/r" }));
    await new Promise((res) => setTimeout(res, 200));
    expect(endpoint.registry.size()).toBe(1);
    ws.close();
    await new Promise((res) => setTimeout(res, 300));
    expect(endpoint.registry.size()).toBe(0);
  });

  test("machineName 缺失时用 machineId 前缀兜底", async () => {
    const { port, endpoint } = await startServer();
    const r = await connect(port, goodHeaders("acct-y", "abcdef0123456789"));
    const ws = r.ws as WebSocket;
    await nextMessage(ws);
    ws.send(JSON.stringify({ type: "hello", root: "/r" }));
    await new Promise((res) => setTimeout(res, 200));
    expect(endpoint.registry.listByAccount("acct-y")[0].machineName).toBe("abcdef01");
    ws.close();
  });
});

describe("worker 端点 · 消息健壮性", () => {
  async function connected(port: number, account = "acct-1", machine = "machine-1"): Promise<WebSocket> {
    const r = await connect(port, goodHeaders(account, machine));
    const ws = r.ws as WebSocket;
    await nextMessage(ws);
    ws.send(JSON.stringify({ type: "hello", machineName: "m", root: "/r" }));
    await new Promise((res) => setTimeout(res, 150));
    return ws;
  }

  test("畸形 JSON / 未知 type / 非对象 全部静默忽略且连接存活", async () => {
    const { port } = await startServer();
    const ws = await connected(port);
    ws.send("{ 这不是 json");
    ws.send(JSON.stringify(["数组不是对象"]));
    ws.send(JSON.stringify({ type: "从没见过的类型" }));
    ws.send(JSON.stringify({ 没有type字段: 1 }));
    await new Promise((res) => setTimeout(res, 250));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  test("未派发过的 execId 发来的 chunk/done 被拒(跨机篡改防护)", async () => {
    const { port, endpoint } = await startServer();
    const ws = await connected(port);
    const { execId, result } = endpoint.execQueue.submit("conv-victim", "echo hi");
    ws.send(JSON.stringify({ type: "chunk", execId, stream: "stdout", data: "注入的输出" }));
    ws.send(JSON.stringify({ type: "done", execId, exitCode: 0 }));
    await new Promise((res) => setTimeout(res, 300));
    let settled = false;
    void result.then(() => { settled = true; });
    await new Promise((res) => setTimeout(res, 100));
    expect(settled).toBe(false);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  test("派发过的 execId:chunk 累积、done 兑现 result", async () => {
    const { port, endpoint } = await startServer();
    const ws = await connected(port, "acct-d", "machine-d");
    const conn = endpoint.registry.listByAccount("acct-d")[0];
    const { execId, result } = endpoint.execQueue.submit("conv-1", "npm test");
    const pending = endpoint.execQueue.take("conv-1");
    expect(pending).not.toBeNull();
    expect(endpoint.dispatchExec(conn.connId, pending as never, 60_000)).toBe(true);
    const sent = await nextMessage(ws);
    expect(sent.type).toBe("exec");
    expect(sent.execId).toBe(execId);
    expect(sent.command).toBe("npm test");
    ws.send(JSON.stringify({ type: "chunk", execId, stream: "stdout", data: "第一段 " }));
    ws.send(JSON.stringify({ type: "chunk", execId, stream: "stderr", data: "警告" }));
    ws.send(JSON.stringify({ type: "done", execId, exitCode: 0 }));
    const outcome = await result;
    expect(outcome.stdout).toBe("第一段 ");
    expect(outcome.stderr).toBe("警告");
    expect(outcome.exitCode).toBe(0);
    expect(outcome.timedOut).toBe(false);
    ws.close();
  });

  test("stream 值非法的 chunk 被忽略", async () => {
    const { port, endpoint } = await startServer();
    const ws = await connected(port, "acct-s", "machine-s");
    const conn = endpoint.registry.listByAccount("acct-s")[0];
    const { execId, result } = endpoint.execQueue.submit("conv-s", "x");
    endpoint.dispatchExec(conn.connId, endpoint.execQueue.take("conv-s") as never, 60_000);
    await nextMessage(ws);
    ws.send(JSON.stringify({ type: "chunk", execId, stream: "stdin", data: "不该被收" }));
    ws.send(JSON.stringify({ type: "done", execId, exitCode: 0 }));
    const outcome = await result;
    expect(outcome.stdout).toBe("");
    expect(outcome.stderr).toBe("");
    ws.close();
  });

  test("exitCode 非有限数的 done 被忽略", async () => {
    const { port, endpoint } = await startServer();
    const ws = await connected(port, "acct-e", "machine-e");
    const conn = endpoint.registry.listByAccount("acct-e")[0];
    const { execId, result } = endpoint.execQueue.submit("conv-e", "x");
    endpoint.dispatchExec(conn.connId, endpoint.execQueue.take("conv-e") as never, 60_000);
    await nextMessage(ws);
    ws.send(JSON.stringify({ type: "done", execId, exitCode: "零" }));
    await new Promise((res) => setTimeout(res, 250));
    let settled = false;
    void result.then(() => { settled = true; });
    await new Promise((res) => setTimeout(res, 100));
    expect(settled).toBe(false);
    ws.send(JSON.stringify({ type: "done", execId, exitCode: 3 }));
    expect((await result).exitCode).toBe(3);
    ws.close();
  });

  test("dispatchExec 对不存在的 connId 返回 false", async () => {
    const { port, endpoint } = await startServer();
    await connected(port);
    endpoint.execQueue.submit("conv-z", "x");
    const pending = endpoint.execQueue.take("conv-z");
    expect(endpoint.dispatchExec("不存在的连接", pending as never, 1000)).toBe(false);
  });

  test("close() 可重复调用且不抛", async () => {
    const { endpoint } = await startServer();
    expect(() => { endpoint.close(); endpoint.close(); }).not.toThrow();
  });
});