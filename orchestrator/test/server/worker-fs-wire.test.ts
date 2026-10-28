import { describe, expect, test, afterEach } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import { mkdtemp, writeFile, mkdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachWorkerWebSocket, WORKER_WS_PATH } from "../../src/server/worker/worker-endpoint.js";
import { createWorkerClient, type WorkerClient } from "../../src/server/worker/worker-client.js";
import WebSocket from "ws";
import { signWorkerToken, newMachineId, WORKER_PROTOCOL_VERSION } from "../../src/server/worker/worker-token.js";
import type { WorkerFsOp } from "../../src/server/worker/tool-surface.js";

const SECRET = "fs-wire-secret";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) {
    try { await fn(); } catch { /* 清理尽力而为 */ }
  }
});

async function setup(): Promise<{
  endpoint: ReturnType<typeof attachWorkerWebSocket>;
  client: WorkerClient;
  root: string;
  connId: string;
  wsUrl: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "kp-fs-wire-"));
  const server: Server = http.createServer((_req, res) => res.end("ok"));
  const endpoint = attachWorkerWebSocket(server, { resolveSecret: async () => SECRET });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (typeof addr === "string" || addr === null) throw new Error("拿不到端口");
  const client = createWorkerClient({
    url: `ws://127.0.0.1:${addr.port}${WORKER_WS_PATH}`,
    token: signWorkerToken("acct-1", newMachineId(), SECRET, Date.now()),
    machineName: "fs 测试机",
    root,
  });
  cleanups.push(() => client.stop());
  cleanups.push(() => { endpoint.close(); server.close(); });
  client.start();
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && endpoint.registry.listByAccount("acct-1").length === 0) {
    await new Promise((r) => setTimeout(r, 25));
  }
  const conn = endpoint.registry.listByAccount("acct-1")[0];
  if (!conn) throw new Error("工作机没连上");
  return { endpoint, client, root, connId: conn.connId, wsUrl: `ws://127.0.0.1:${addr.port}${WORKER_WS_PATH}` };
}

async function run(
  ctx: { endpoint: ReturnType<typeof attachWorkerWebSocket>; connId: string },
  op: WorkerFsOp,
): Promise<{ ok: boolean; data?: string; error?: string; timedOut: boolean }> {
  const { result } = ctx.endpoint.fsQueue.submit("conv-1", op, { timeoutMs: 6000 });
  const pending = ctx.endpoint.fsQueue.take("conv-1");
  expect(pending).not.toBeNull();
  expect(ctx.endpoint.dispatchFs(ctx.connId, pending as never)).toBe(true);
  return result;
}

describe("六个文件操作端到端", () => {
  test("write 然后 read", async () => {
    const ctx = await setup();
    const w = await run(ctx, { op: "fs", kind: "write", path: "a.txt", content: "你好世界" });
    expect(w.ok).toBe(true);
    expect(await readFile(join(ctx.root, "a.txt"), "utf8")).toBe("你好世界");
    const r = await run(ctx, { op: "fs", kind: "read", path: "a.txt" });
    expect(r.ok).toBe(true);
    expect(r.data).toBe("你好世界");
  }, 30_000);

  test("write 会自动创建父目录", async () => {
    const ctx = await setup();
    const w = await run(ctx, { op: "fs", kind: "write", path: "深/一点/b.txt", content: "x" });
    expect(w.ok).toBe(true);
    expect(await readFile(join(ctx.root, "深/一点/b.txt"), "utf8")).toBe("x");
  }, 30_000);

  test("mkdir 递归建目录", async () => {
    const ctx = await setup();
    const m = await run(ctx, { op: "fs", kind: "mkdir", path: "x/y/z" });
    expect(m.ok).toBe(true);
    expect((await stat(join(ctx.root, "x/y/z"))).isDirectory()).toBe(true);
  }, 30_000);

  test("list 列出条目", async () => {
    const ctx = await setup();
    await writeFile(join(ctx.root, "one.txt"), "1");
    await mkdir(join(ctx.root, "sub"));
    const l = await run(ctx, { op: "fs", kind: "list", path: "." });
    expect(l.ok).toBe(true);
    expect(String(l.data)).toContain("one.txt");
    expect(String(l.data)).toContain("sub");
  }, 30_000);

  test("stat 返回类型与大小", async () => {
    const ctx = await setup();
    await writeFile(join(ctx.root, "s.txt"), "12345");
    const s = await run(ctx, { op: "fs", kind: "stat", path: "s.txt" });
    expect(s.ok).toBe(true);
    const parsed = JSON.parse(String(s.data)) as Record<string, unknown>;
    expect(parsed.type).toBe("file");
    expect(parsed.size).toBe(5);
    expect(typeof parsed.mtimeMs).toBe("number");
  }, 30_000);

  test("delete 删掉文件", async () => {
    const ctx = await setup();
    await writeFile(join(ctx.root, "gone.txt"), "x");
    const d = await run(ctx, { op: "fs", kind: "delete", path: "gone.txt" });
    expect(d.ok).toBe(true);
    await expect(stat(join(ctx.root, "gone.txt"))).rejects.toThrow();
  }, 30_000);
});

describe("失败路径必须回结果,不能挂死", () => {
  test("读不存在的文件 → ok:false 且有 error", async () => {
    const ctx = await setup();
    const r = await run(ctx, { op: "fs", kind: "read", path: "没有这个文件.txt" });
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(false);
    expect(String(r.error).length).toBeGreaterThan(0);
  }, 30_000);

  test("未知 kind → ok:false 且 error 含该 kind", async () => {
    const ctx = await setup();
    const r = await run(ctx, { op: "fs", kind: "没见过" as never, path: "a.txt" });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain("没见过");
  }, 30_000);

  test("stat 不存在的路径 → ok:false", async () => {
    const ctx = await setup();
    expect((await run(ctx, { op: "fs", kind: "stat", path: "无" })).ok).toBe(false);
  }, 30_000);
});

describe("客户端侧的第二道路径防线", () => {
  test("越权路径被拦,且不写到 root 外面", async () => {
    const ctx = await setup();
    for (const path of ["../逃出去.txt", "/tmp/绝对路径.txt", "a/../../b.txt"]) {
      const r = await run(ctx, { op: "fs", kind: "write", path, content: "不该写成功" });
      expect(r.ok, `${path} 应当被拒`).toBe(false);
      expect(r.timedOut, `${path} 不该超时`).toBe(false);
    }
  }, 30_000);

  test("越权的 read 同样被拒", async () => {
    const ctx = await setup();
    const r = await run(ctx, { op: "fs", kind: "read", path: "../../../etc/passwd" });
    expect(r.ok).toBe(false);
  }, 30_000);
});

describe("跨机篡改防护", () => {
  test("攻击者连接发来的伪造 fsResult 被忽略(真的发,不是只等超时)", async () => {
    const ctx = await setup();
    // 攻击者:另一个账号的裸连接,拿到 opId 后抢答
    const evil = new WebSocket(ctx.wsUrl, {
      headers: {
        Authorization: `Bearer ${signWorkerToken("acct-evil", newMachineId(), SECRET, Date.now())}`,
        "X-Kunpeng-Worker-Protocol": String(WORKER_PROTOCOL_VERSION),
      },
    });
    cleanups.push(() => evil.close());
    await new Promise<void>((resolve, reject) => {
      evil.on("message", (raw: Buffer) => {
        const m = JSON.parse(raw.toString("utf8")) as { type?: string };
        if (m.type === "ready") {
          evil.send(JSON.stringify({ type: "hello", machineName: "坏机器", root: "/tmp" }));
          setTimeout(resolve, 150);
        }
      });
      evil.on("error", reject);
      setTimeout(() => reject(new Error("攻击者连不上")), 6000);
    });

    const { opId, result } = ctx.endpoint.fsQueue.submit(
      "conv-受害", { op: "fs", kind: "read", path: "a.txt" }, { timeoutMs: 1500 },
    );
    // 不派发给任何人;攻击者硬塞一条伪造结果
    evil.send(JSON.stringify({ type: "fsResult", opId, ok: true, data: "伪造的文件内容" }));
    const outcome = await result;
    expect(outcome.timedOut).toBe(true);
    expect(outcome.ok).toBe(false);
    expect(String(outcome.data ?? "")).not.toContain("伪造");
    expect(evil.readyState).toBe(WebSocket.OPEN);
  }, 30_000);

  test("派发给甲的 opId,乙抢答无效", async () => {
    const ctx = await setup();
    await writeFile(join(ctx.root, "真.txt"), "真实内容");
    const evil = new WebSocket(ctx.wsUrl, {
      headers: {
        Authorization: `Bearer ${signWorkerToken("acct-evil-2", newMachineId(), SECRET, Date.now())}`,
        "X-Kunpeng-Worker-Protocol": String(WORKER_PROTOCOL_VERSION),
      },
    });
    cleanups.push(() => evil.close());
    await new Promise<void>((resolve, reject) => {
      evil.on("message", (raw: Buffer) => {
        const m = JSON.parse(raw.toString("utf8")) as { type?: string };
        if (m.type === "ready") {
          evil.send(JSON.stringify({ type: "hello", machineName: "坏机器2", root: "/tmp" }));
          setTimeout(resolve, 150);
        }
      });
      evil.on("error", reject);
      setTimeout(() => reject(new Error("攻击者连不上")), 6000);
    });

    const { opId, result } = ctx.endpoint.fsQueue.submit(
      "conv-2", { op: "fs", kind: "read", path: "真.txt" }, { timeoutMs: 6000 },
    );
    const pending = ctx.endpoint.fsQueue.take("conv-2");
    evil.send(JSON.stringify({ type: "fsResult", opId, ok: true, data: "抢答的假内容" }));
    expect(ctx.endpoint.dispatchFs(ctx.connId, pending as never)).toBe(true);
    const outcome = await result;
    expect(outcome.ok).toBe(true);
    expect(outcome.data).toBe("真实内容");
  }, 30_000);
});

describe("既有行为一条不破", () => {
  test("exec 仍然可用,且与 fs 共用串行队列不交错", async () => {
    const ctx = await setup();
    const exec = ctx.endpoint.execQueue.submit("conv-e", "echo 命令跑了");
    ctx.endpoint.dispatchExec(ctx.connId, ctx.endpoint.execQueue.take("conv-e") as never, 20_000);
    const fsResult = run(ctx, { op: "fs", kind: "write", path: "并发.txt", content: "并发写" });
    const [e, f] = await Promise.all([exec.result, fsResult]);
    expect(e.stdout).toContain("命令跑了");
    expect(e.exitCode).toBe(0);
    expect(f.ok).toBe(true);
    expect(await readFile(join(ctx.root, "并发.txt"), "utf8")).toBe("并发写");
  }, 30_000);

  test("hello 注册与断线摘除仍然正常", async () => {
    const ctx = await setup();
    expect(ctx.endpoint.registry.listByAccount("acct-1").length).toBe(1);
    await ctx.client.stop();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && ctx.endpoint.registry.size() > 0) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(ctx.endpoint.registry.size()).toBe(0);
  }, 30_000);

  test("dispatchFs 对不存在的连接返回 false", async () => {
    const ctx = await setup();
    ctx.endpoint.fsQueue.submit("conv-z", { op: "fs", kind: "read", path: "a.txt" });
    const pending = ctx.endpoint.fsQueue.take("conv-z");
    expect(ctx.endpoint.dispatchFs("不存在的连接", pending as never)).toBe(false);
  }, 30_000);
});