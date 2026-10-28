import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import WebSocket from "ws";

import { attachPtyWebSocket } from "../../src/server/pty-endpoint.js";
import { PtySessionPool, type PtyHandle, type PtySpawnOpts } from "../../src/server/pty-pool.js";

function fakeFactory(): (o: PtySpawnOpts) => PtyHandle {
  return () => ({ write() {}, resize() {}, onData() {}, onExit() {}, kill() {} });
}

async function openPty(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/workspace/w1/pty`);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("等待 session 消息超时")), 5000);
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as { type?: string };
      if (msg.type === "session") {
        clearTimeout(timer);
        resolve();
      }
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
  return ws;
}

describe("pty-endpoint WebSocket error 加固", () => {
  let server: Server | undefined;

  afterEach(async () => {
    const s = server;
    server = undefined;
    if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
  });

  it("客户端注入未置 MASK 的非法帧后进程存活,新连接仍可建立", async () => {
    const srv = createServer();
    server = srv;
    attachPtyWebSocket(srv, {
      stateDir: `/nonexistent-kp-state-${process.pid}`,
      resolveCwd: async () => process.cwd(),
      pool: new PtySessionPool({ factory: fakeFactory() }),
    });
    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", () => resolve()));
    const addr = srv.address();
    if (addr === null || typeof addr === "string") throw new Error("no port");
    const port = addr.port;

    const ws1 = await openPty(port);
    // RFC6455:客户端帧必须置 MASK 位;发未掩码文本帧令服务端 ws 触发 "error"。
    // 修复前该事件无监听 → EventEmitter 同步抛出,vitest worker 崩溃,本文件必红。
    (ws1 as unknown as { _socket: { write(b: Buffer): void } })._socket.write(
      Buffer.from([0x81, 0x01, 0x41]),
    );
    await once(ws1, "close");

    const ws2 = await openPty(port);
    expect(ws2.readyState).toBe(WebSocket.OPEN);
    ws2.terminate();
    ws1.terminate();
  }, 15_000);
});