import { describe, expect, test, afterEach } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { attachWorkerWebSocket, WORKER_WS_PATH } from "../../src/server/worker/worker-endpoint.js";
import { createWorkerClient, type WorkerClient } from "../../src/server/worker/worker-client.js";
import { signWorkerToken, newMachineId, WORKER_PROTOCOL_VERSION } from "../../src/server/worker/worker-token.js";
import type { WorkerFsOp } from "../../src/server/worker/tool-surface.js";

const SECRET = "bounds-secret";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) {
    try { await fn(); } catch { /* 清理尽力而为 */ }
  }
});

async function host(opts: Record<string, unknown> = {}): Promise<{
  endpoint: ReturnType<typeof attachWorkerWebSocket>;
  url: string;
}> {
  const server: Server = http.createServer((_req, res) => res.end("ok"));
  const endpoint = attachWorkerWebSocket(server, {
    resolveSecret: async () => SECRET,
    ...opts,
  } as never);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (typeof addr === "string" || addr === null) throw new Error("拿不到端口");
  cleanups.push(() => { endpoint.close(); server.close(); });
  return { endpoint, url: `ws://127.0.0.1:${addr.port}${WORKER_WS_PATH}` };
}

/** 裸连接 + hello,返回 socket 与收到的全部消息。 */
function joinRaw(
  url: string,
  accountId: string,
  machineId: string,
  hello: Record<string, unknown>,
): Promise<{ ws: WebSocket; seen: Array<Record<string, unknown>> }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${signWorkerToken(accountId, machineId, SECRET, Date.now())}`,
        "X-Kunpeng-Worker-Protocol": String(WORKER_PROTOCOL_VERSION),
      },
    });
    const seen: Array<Record<string, unknown>> = [];
    cleanups.push(() => ws.close());
    ws.on("message", (raw: Buffer) => {
      const msg = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
      seen.push(msg);
      if (msg.type === "ready") {
        ws.send(JSON.stringify({ type: "hello", ...hello }));
        setTimeout(() => resolve({ ws, seen }), 200);
      }
    });
    ws.on("error", () => resolve({ ws, seen }));
    setTimeout(() => resolve({ ws, seen }), 6000);
  });
}

describe("每账号在线机器数上限", () => {
  test("达上限后第 N+1 台被拒,且前面的仍在线", async () => {
    const { endpoint, url } = await host({ maxMachinesPerAccount: 3 });
    for (let i = 0; i < 3; i += 1) {
      await joinRaw(url, "acct-cap", newMachineId(), { machineName: `m${i}`, root: "/tmp" });
    }
    expect(endpoint.registry.listByAccount("acct-cap").length).toBe(3);

    const extra = await joinRaw(url, "acct-cap", newMachineId(), { machineName: "第四台", root: "/tmp" });
    expect(endpoint.registry.listByAccount("acct-cap").length, "上限后不得再增").toBe(3);
    expect(extra.seen.some((m) => m.reason === "machine-limit"), "应当收到 machine-limit").toBe(true);
  }, 30_000);

  test("同一台机器重连不受上限影响", async () => {
    const { endpoint, url } = await host({ maxMachinesPerAccount: 2 });
    const idA = newMachineId();
    const idB = newMachineId();
    await joinRaw(url, "acct-re", idA, { machineName: "A", root: "/tmp" });
    await joinRaw(url, "acct-re", idB, { machineName: "B", root: "/tmp" });
    expect(endpoint.registry.listByAccount("acct-re").length).toBe(2);

    const again = await joinRaw(url, "acct-re", idA, { machineName: "A重连", root: "/tmp" });
    expect(endpoint.registry.listByAccount("acct-re").length, "重连不该被上限挡").toBe(2);
    expect(again.seen.some((m) => m.reason === "machine-limit")).toBe(false);
    expect(endpoint.registry.findMachine("acct-re", idA)?.machineName).toBe("A重连");
  }, 30_000);

  test("别的账号不受影响", async () => {
    const { endpoint, url } = await host({ maxMachinesPerAccount: 1 });
    await joinRaw(url, "acct-x", newMachineId(), { machineName: "x", root: "/tmp" });
    await joinRaw(url, "acct-y", newMachineId(), { machineName: "y", root: "/tmp" });
    expect(endpoint.registry.listByAccount("acct-x").length).toBe(1);
    expect(endpoint.registry.listByAccount("acct-y").length).toBe(1);
  }, 30_000);
});

describe("hello 自报字段长度上限", () => {
  test("超长 machineName 被截断到 80", async () => {
    const { endpoint, url } = await host();
    await joinRaw(url, "acct-name", newMachineId(), { machineName: "长".repeat(5000), root: "/tmp" });
    const conn = endpoint.registry.listByAccount("acct-name")[0];
    expect(conn).toBeDefined();
    expect(conn.machineName.length).toBeLessThanOrEqual(80);
  }, 30_000);

  test("超长 root 被截断到 512", async () => {
    const { endpoint, url } = await host();
    await joinRaw(url, "acct-root", newMachineId(), { machineName: "m", root: `/${"深".repeat(5000)}` });
    const conn = endpoint.registry.listByAccount("acct-root")[0];
    expect(conn.root.length).toBeLessThanOrEqual(512);
  }, 30_000);

  test("正常长度原样不动", async () => {
    const { endpoint, url } = await host();
    await joinRaw(url, "acct-ok", newMachineId(), { machineName: "我的出差本", root: "/Users/me/code" });
    const conn = endpoint.registry.listByAccount("acct-ok")[0];
    expect(conn.machineName).toBe("我的出差本");
    expect(conn.root).toBe("/Users/me/code");
  }, 30_000);

  test("缺失 machineName 仍回落到 machineId 前缀", async () => {
    const { endpoint, url } = await host();
    const id = newMachineId();
    await joinRaw(url, "acct-fb", id, { root: "/tmp" });
    expect(endpoint.registry.listByAccount("acct-fb")[0].machineName).toBe(id.slice(0, 8));
  }, 30_000);
});

describe("list 结果上限", () => {
  async function withClient(): Promise<{
    endpoint: ReturnType<typeof attachWorkerWebSocket>;
    root: string;
    connId: string;
    client: WorkerClient;
  }> {
    const root = await mkdtemp(join(tmpdir(), "kp-bounds-"));
    const { endpoint, url } = await host();
    const client = createWorkerClient({
      url,
      token: signWorkerToken("acct-l", newMachineId(), SECRET, Date.now()),
      machineName: "列表机", root,
    });
    cleanups.push(() => client.stop());
    client.start();
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && endpoint.registry.listByAccount("acct-l").length === 0) {
      await new Promise((r) => setTimeout(r, 25));
    }
    const conn = endpoint.registry.listByAccount("acct-l")[0];
    if (!conn) throw new Error("没连上");
    return { endpoint, root, connId: conn.connId, client };
  }

  async function runOp(
    ctx: { endpoint: ReturnType<typeof attachWorkerWebSocket>; connId: string },
    op: WorkerFsOp,
  ): Promise<{ ok: boolean; data?: string; error?: string }> {
    const { result } = ctx.endpoint.fsQueue.submit("c", op, { timeoutMs: 20_000 });
    ctx.endpoint.dispatchFs(ctx.connId, ctx.endpoint.fsQueue.take("c") as never);
    return result;
  }

  test("3000 个条目被截断到 2000 以内,且带明确提示", async () => {
    const ctx = await withClient();
    const dir = join(ctx.root, "huge");
    await mkdir(dir, { recursive: true });
    await Promise.all(Array.from({ length: 3000 }, (_, i) => writeFile(join(dir, `f${i}.txt`), "x", "utf8")));
    const r = await runOp(ctx, { op: "fs", kind: "list", path: "huge" });
    expect(r.ok).toBe(true);
    const lines = String(r.data).split("\n");
    expect(lines.length).toBeLessThanOrEqual(2001);
    expect(String(r.data)).toContain("截断");
  }, 60_000);

  test("小目录输出不含截断提示", async () => {
    const ctx = await withClient();
    const dir = join(ctx.root, "small");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "a.txt"), "1", "utf8");
    await writeFile(join(dir, "b.txt"), "2", "utf8");
    const r = await runOp(ctx, { op: "fs", kind: "list", path: "small" });
    expect(r.ok).toBe(true);
    expect(String(r.data)).not.toContain("截断");
    expect(String(r.data).split("\n").sort()).toEqual(["a.txt", "b.txt"]);
  }, 30_000);

  test("递归 list 同样受限", async () => {
    const ctx = await withClient();
    for (let d = 0; d < 30; d += 1) {
      const dir = join(ctx.root, "deep", `d${d}`);
      await mkdir(dir, { recursive: true });
      await Promise.all(Array.from({ length: 100 }, (_, i) => writeFile(join(dir, `f${i}.txt`), "x", "utf8")));
    }
    const r = await runOp(ctx, { op: "fs", kind: "list", path: "deep", recursive: true });
    expect(r.ok).toBe(true);
    expect(String(r.data).split("\n").length).toBeLessThanOrEqual(2001);
  }, 60_000);
});

describe("既有防线一条不破", () => {
  test("软链仍然逃不出去", async () => {
    const root = await mkdtemp(join(tmpdir(), "kp-bounds-sym-"));
    const outside = await mkdtemp(join(tmpdir(), "kp-bounds-out-"));
    await writeFile(join(outside, "机密.txt"), "外部", "utf8");
    const { symlink } = await import("node:fs/promises");
    await symlink(outside, join(root, "link"));
    const { endpoint, url } = await host();
    const client = createWorkerClient({
      url, token: signWorkerToken("acct-s", newMachineId(), SECRET, Date.now()),
      machineName: "m", root,
    });
    cleanups.push(() => client.stop());
    client.start();
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && endpoint.registry.listByAccount("acct-s").length === 0) {
      await new Promise((r) => setTimeout(r, 25));
    }
    const conn = endpoint.registry.listByAccount("acct-s")[0];
    const { result } = endpoint.fsQueue.submit("c", { op: "fs", kind: "read", path: "link/机密.txt" }, { timeoutMs: 8000 });
    endpoint.dispatchFs(conn.connId, endpoint.fsQueue.take("c") as never);
    expect((await result).ok).toBe(false);
  }, 30_000);

  test("exec 不受影响", async () => {
    const root = await mkdtemp(join(tmpdir(), "kp-bounds-exec-"));
    const { endpoint, url } = await host();
    const client = createWorkerClient({
      url, token: signWorkerToken("acct-e", newMachineId(), SECRET, Date.now()),
      machineName: "m", root,
    });
    cleanups.push(() => client.stop());
    client.start();
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && endpoint.registry.listByAccount("acct-e").length === 0) {
      await new Promise((r) => setTimeout(r, 25));
    }
    const conn = endpoint.registry.listByAccount("acct-e")[0];
    const { result } = endpoint.execQueue.submit("c", "echo 上限改动没影响 exec");
    endpoint.dispatchExec(conn.connId, endpoint.execQueue.take("c") as never, 20_000);
    expect((await result).stdout).toContain("上限改动没影响 exec");
  }, 30_000);
});