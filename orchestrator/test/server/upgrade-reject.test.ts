import { describe, expect, test, afterEach } from "vitest";
import http from "node:http";
import net from "node:net";
import type { Server } from "node:http";
import { readFile } from "node:fs/promises";
import { registerUpgradeRoute, rejectUpgrade } from "../../src/server/ws-upgrade-router.js";

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) {
    try { s.close(); } catch { /* 清理尽力而为 */ }
  }
});

async function listen(handler: (socket: net.Socket) => void): Promise<number> {
  const server = http.createServer((_req, res) => res.end("ok"));
  servers.push(server);
  server.on("upgrade", (_req, socket) => { handler(socket as net.Socket); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (typeof addr === "string" || addr === null) throw new Error("拿不到端口");
  return addr.port;
}

/** 慢读客户端:连上后等 200ms 才开始读,模拟代理。返回收到的完整原文。 */
function slowRead(port: number, path = "/x"): Promise<string> {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => {
      s.write(`GET ${path} HTTP/1.1\r\nHost: h\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
      s.pause();
      setTimeout(() => s.resume(), 200);
    });
    let got = "";
    s.on("data", (d) => { got += d.toString("utf8"); });
    s.on("error", () => resolve(got));
    s.on("close", () => resolve(got));
    setTimeout(() => { s.destroy(); resolve(got); }, 4000);
  });
}

function parseResponse(raw: string): { status: string; headers: Record<string, string>; body: string } {
  const split = raw.indexOf("\r\n\r\n");
  const head = split >= 0 ? raw.slice(0, split) : raw;
  const body = split >= 0 ? raw.slice(split + 4) : "";
  const lines = head.split("\r\n");
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const at = line.indexOf(":");
    if (at > 0) headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return { status: lines[0] ?? "", headers, body };
}

describe("rejectUpgrade 的响应形状", () => {
  test("带 Content-Length,且等于 body 的字节长度", async () => {
    const port = await listen((socket) => { rejectUpgrade(socket, "401 Unauthorized"); });
    const res = parseResponse(await slowRead(port));
    expect(res.status).toContain("401");
    expect(res.headers["content-length"]).toBeDefined();
    expect(Number(res.headers["content-length"])).toBe(Buffer.byteLength(res.body, "utf8"));
  });

  test("中文 message 的 Content-Length 按字节算而不是字符数", async () => {
    const message = "未登录";
    const port = await listen((socket) => { rejectUpgrade(socket, "401 Unauthorized", { message }); });
    const res = parseResponse(await slowRead(port));
    const declared = Number(res.headers["content-length"]);
    expect(declared).toBe(Buffer.byteLength(res.body, "utf8"));
    expect(declared).toBeGreaterThan(res.body.length);
    expect(JSON.parse(res.body).error).toBe(message);
  });

  test("body 是可解析 JSON 且有 error 字段", async () => {
    const port = await listen((socket) => { rejectUpgrade(socket, "403 Forbidden"); });
    const res = parseResponse(await slowRead(port));
    expect(res.headers["content-type"]).toContain("application/json");
    expect(() => JSON.parse(res.body)).not.toThrow();
    expect(typeof JSON.parse(res.body).error).toBe("string");
  });

  test("慢读客户端拿到完整响应,不被截断", async () => {
    const message = "这是一段足够长的中文说明用来验证不会被截断";
    const port = await listen((socket) => { rejectUpgrade(socket, "426 Upgrade Required", { message }); });
    for (let i = 0; i < 5; i += 1) {
      const res = parseResponse(await slowRead(port));
      expect(JSON.parse(res.body).error, `第 ${i + 1} 次`).toBe(message);
    }
  });

  test("附加头正常带出", async () => {
    const port = await listen((socket) => {
      rejectUpgrade(socket, "426 Upgrade Required", { headers: { "X-Kunpeng-Reason": "protocol-mismatch" } });
    });
    const res = parseResponse(await slowRead(port));
    expect(res.headers["x-kunpeng-reason"]).toBe("protocol-mismatch");
    expect(res.headers["connection"]).toBe("close");
  });

  test("对已销毁的 socket 调用不抛", async () => {
    const s = new net.Socket();
    s.destroy();
    expect(() => rejectUpgrade(s, "401 Unauthorized")).not.toThrow();
  });

  test("路由器的无匹配 404 也走同一形状", async () => {
    const server = http.createServer((_req, res) => res.end("ok"));
    servers.push(server);
    registerUpgradeRoute(server, {
      name: "只认 /yes",
      matches: (p) => p === "/yes",
      handle: ((_r: unknown, socket: net.Socket) => {
        socket.end("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
      }) as never,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (typeof addr === "string" || addr === null) throw new Error("拿不到端口");
    const res = parseResponse(await slowRead(addr.port, "/nowhere"));
    expect(res.status).toContain("404");
    expect(Number(res.headers["content-length"])).toBe(Buffer.byteLength(res.body, "utf8"));
  });
});

describe("三个文件都不许再裸写响应", () => {
  const files = [
    "../../src/server/ws-upgrade-router.ts",
    "../../src/server/pty-endpoint.ts",
    "../../src/server/worker/worker-endpoint.ts",
  ];

  test("除 helper 自身外,没有裸 socket.write(\"HTTP/1.1", async () => {
    for (const rel of files) {
      const source = await readFile(new URL(rel, import.meta.url), "utf8");
      const bare = source.split("\n").filter((line) => line.includes('socket.write("HTTP/1.1'));
      expect(bare, `${rel} 仍有裸写`).toEqual([]);
    }
  });

  test("pty 与 worker 都引用了共享 helper", async () => {
    for (const rel of files.slice(1)) {
      const source = await readFile(new URL(rel, import.meta.url), "utf8");
      expect(source, rel).toContain("rejectUpgrade");
    }
  });
});