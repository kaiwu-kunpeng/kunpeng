import { describe, expect, test, afterEach } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachWorkerWebSocket, WORKER_WS_PATH } from "../../src/server/worker/worker-endpoint.js";
import { createWorkerClient, type WorkerClient } from "../../src/server/worker/worker-client.js";
import { signWorkerToken, newMachineId } from "../../src/server/worker/worker-token.js";
import { toolToWorkerOp } from "../../src/server/worker/tool-surface.js";
import type { WorkerFsOp } from "../../src/server/worker/tool-surface.js";

const SECRET = "fs-binary-secret";

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
}> {
  const root = await mkdtemp(join(tmpdir(), "kp-fs-bin-"));
  const server: Server = http.createServer((_req, res) => res.end("ok"));
  const endpoint = attachWorkerWebSocket(server, { resolveSecret: async () => SECRET });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (typeof addr === "string" || addr === null) throw new Error("拿不到端口");
  const client = createWorkerClient({
    url: `ws://127.0.0.1:${addr.port}${WORKER_WS_PATH}`,
    token: signWorkerToken("acct-1", newMachineId(), SECRET, Date.now()),
    machineName: "二进制测试机",
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
  return { endpoint, client, root, connId: conn.connId };
}

async function run(
  ctx: { endpoint: ReturnType<typeof attachWorkerWebSocket>; connId: string },
  op: WorkerFsOp,
): Promise<{ ok: boolean; data?: string; error?: string; timedOut: boolean; encoding?: string }> {
  const { result } = ctx.endpoint.fsQueue.submit("conv-bin", op, { timeoutMs: 8000 });
  const pending = ctx.endpoint.fsQueue.take("conv-bin");
  expect(pending).not.toBeNull();
  expect(ctx.endpoint.dispatchFs(ctx.connId, pending as never)).toBe(true);
  return result;
}

/** 造一段一定是二进制的内容:含 0x00,且不是合法 UTF-8。 */
function binaryBytes(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x42, 0xc3, 0x28]);
}

describe("文本行为不退化", () => {
  test("中文文本照旧原样返回", async () => {
    const ctx = await setup();
    await writeFile(join(ctx.root, "t.txt"), "你好世界\n第二行", "utf8");
    const r = await run(ctx, { op: "fs", kind: "read", path: "t.txt" });
    expect(r.ok).toBe(true);
    expect(r.data).toBe("你好世界\n第二行");
    expect(r.encoding === undefined || r.encoding === "text").toBe(true);
  }, 30_000);

  test("文本写入照旧", async () => {
    const ctx = await setup();
    const w = await run(ctx, { op: "fs", kind: "write", path: "w.txt", content: "普通文本" });
    expect(w.ok).toBe(true);
    expect(await readFile(join(ctx.root, "w.txt"), "utf8")).toBe("普通文本");
  }, 30_000);
});

describe("二进制读", () => {
  test("含 0x00 的文件以 base64 返回,解回来字节完全一致", async () => {
    const ctx = await setup();
    const bytes = binaryBytes();
    await writeFile(join(ctx.root, "b.bin"), bytes);
    const r = await run(ctx, { op: "fs", kind: "read", path: "b.bin" });
    expect(r.ok).toBe(true);
    expect(r.encoding).toBe("base64");
    expect(Buffer.from(String(r.data), "base64").equals(bytes)).toBe(true);
  }, 30_000);

  test("返回的是纯 base64,不带 data URL 前缀", async () => {
    const ctx = await setup();
    await writeFile(join(ctx.root, "b2.bin"), binaryBytes());
    const r = await run(ctx, { op: "fs", kind: "read", path: "b2.bin" });
    expect(String(r.data)).not.toContain("data:");
    expect(String(r.data)).toMatch(/^[A-Za-z0-9+/]+=*$/);
  }, 30_000);
});

describe("二进制写与往返一致", () => {
  test("带 encoding:base64 写出的字节完全正确", async () => {
    const ctx = await setup();
    const bytes = binaryBytes();
    const w = await run(ctx, {
      op: "fs", kind: "write", path: "out.bin",
      content: bytes.toString("base64"), encoding: "base64",
    });
    expect(w.ok).toBe(true);
    expect((await readFile(join(ctx.root, "out.bin"))).equals(bytes)).toBe(true);
  }, 30_000);

  test("往返:读出来再原样写回去,两个文件字节相同", async () => {
    const ctx = await setup();
    const bytes = binaryBytes();
    await writeFile(join(ctx.root, "src.bin"), bytes);
    const r = await run(ctx, { op: "fs", kind: "read", path: "src.bin" });
    expect(r.encoding).toBe("base64");
    const w = await run(ctx, {
      op: "fs", kind: "write", path: "copy.bin",
      content: String(r.data), encoding: "base64",
    });
    expect(w.ok).toBe(true);
    const a = await readFile(join(ctx.root, "src.bin"));
    const b = await readFile(join(ctx.root, "copy.bin"));
    expect(b.equals(a)).toBe(true);
  }, 30_000);

  test("非法 base64 → 报错,且不留下残缺文件", async () => {
    const ctx = await setup();
    const w = await run(ctx, {
      op: "fs", kind: "write", path: "bad.bin",
      content: "这显然不是合法的 base64!!!", encoding: "base64",
    });
    expect(w.ok).toBe(false);
    expect(w.timedOut).toBe(false);
    await expect(readFile(join(ctx.root, "bad.bin"))).rejects.toThrow();
  }, 30_000);
});

describe("toolToWorkerOp 的 encoding 参数", () => {
  test("ws_write 接受 text / base64", () => {
    expect((toolToWorkerOp("ws_write", { path: "a", content: "x", encoding: "base64" }) as WorkerFsOp).encoding).toBe("base64");
    expect((toolToWorkerOp("ws_write", { path: "a", content: "x", encoding: "text" }) as WorkerFsOp).encoding).toBe("text");
  });

  test("缺省时不塞该字段(与既有测试兼容)", () => {
    expect(toolToWorkerOp("ws_write", { path: "a", content: "x" })).toEqual({
      op: "fs", kind: "write", path: "a", content: "x",
    });
  });

  test("非法 encoding 抛错", () => {
    for (const bad of ["utf8", "hex", "", 42, null, true]) {
      expect(() => toolToWorkerOp("ws_write", { path: "a", content: "x", encoding: bad }), String(bad)).toThrow();
    }
  });

  test("ws_read 不接受 encoding 参数", () => {
    expect(() => toolToWorkerOp("ws_read", { path: "a", encoding: "base64" })).toThrow();
  });
});

describe("既有防线一条不破", () => {
  test("路径越权仍被拦(二进制写也一样)", async () => {
    const ctx = await setup();
    const r = await run(ctx, {
      op: "fs", kind: "write", path: "../逃.bin",
      content: binaryBytes().toString("base64"), encoding: "base64",
    });
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(false);
  }, 30_000);

  test("exec 仍然可用", async () => {
    const ctx = await setup();
    const { result } = ctx.endpoint.execQueue.submit("c", "echo 二进制改动没影响 exec");
    ctx.endpoint.dispatchExec(ctx.connId, ctx.endpoint.execQueue.take("c") as never, 20_000);
    const out = await result;
    expect(out.stdout).toContain("二进制改动没影响 exec");
    expect(out.exitCode).toBe(0);
  }, 30_000);

  test("读不存在的文件仍是 ok:false 而不是挂死", async () => {
    const ctx = await setup();
    const r = await run(ctx, { op: "fs", kind: "read", path: "没有.bin" });
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(false);
  }, 30_000);
});