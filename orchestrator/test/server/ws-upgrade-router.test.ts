import { describe, expect, test, afterEach } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import { registerUpgradeRoute, upgradeRouteNames } from "../../src/server/ws-upgrade-router.js";

const servers: Server[] = [];

afterEach(() => {
  for (const s of servers.splice(0)) {
    try { s.close(); } catch { /* 清理尽力而为 */ }
  }
});

async function listen(): Promise<{ server: Server; port: number }> {
  const server = http.createServer((_req, res) => res.end("ok"));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (typeof addr === "string" || addr === null) throw new Error("拿不到端口");
  return { server, port: addr.port };
}

/** 发一次 upgrade 请求,回报是收到 101、还是被拒/被断。 */
function tryUpgrade(port: number, path: string): Promise<string> {
  return new Promise((resolve) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      path,
      headers: { Connection: "Upgrade", Upgrade: "websocket" },
    });
    let settled = false;
    const done = (v: string): void => { if (!settled) { settled = true; resolve(v); } };
    req.on("upgrade", (_res, socket) => { socket.destroy(); done("101"); });
    req.on("response", (res) => { res.resume(); done(`http-${res.statusCode}`); });
    req.on("error", (err: NodeJS.ErrnoException) => done(`error-${err.code}`));
    req.end();
    setTimeout(() => done("timeout"), 2000);
  });
}

function accept(name: string) {
  return (_req: unknown, socket: { write: (s: string) => void }): void => {
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Route: ${name}\r\n\r\n`);
  };
}

describe("唯一 upgrade 路由器", () => {
  test("注册两条路由后仍只有一个 upgrade 监听器", async () => {
    const { server } = await listen();
    registerUpgradeRoute(server, { name: "a", matches: (p) => p.startsWith("/a"), handle: accept("a") as never });
    registerUpgradeRoute(server, { name: "b", matches: (p) => p.startsWith("/b"), handle: accept("b") as never });
    expect(server.listenerCount("upgrade")).toBe(1);
  });

  test("两条路由共存,互不销毁对方的 socket(实测故障的回归守卫)", async () => {
    const { server, port } = await listen();
    registerUpgradeRoute(server, {
      name: "pty",
      matches: (p) => /^\/api\/workspace\/[^/]+\/pty$/.test(p),
      handle: accept("pty") as never,
    });
    registerUpgradeRoute(server, {
      name: "worker",
      matches: (p) => p.startsWith("/api/worker/"),
      handle: accept("worker") as never,
    });
    expect(await tryUpgrade(port, "/api/workspace/w1/pty")).toBe("101");
    expect(await tryUpgrade(port, "/api/worker/connect")).toBe("101");
  });

  test("未匹配路径得到 404 而不是静默断连", async () => {
    const { server, port } = await listen();
    registerUpgradeRoute(server, { name: "a", matches: (p) => p.startsWith("/a"), handle: accept("a") as never });
    expect(await tryUpgrade(port, "/nowhere")).toBe("http-404");
  });

  test("按注册顺序取第一条匹配的", async () => {
    const { server, port } = await listen();
    const hit: string[] = [];
    registerUpgradeRoute(server, {
      name: "first",
      matches: (p) => p.startsWith("/x"),
      handle: ((_r: unknown, s: { write: (v: string) => void }) => { hit.push("first"); accept("first")(_r, s); }) as never,
    });
    registerUpgradeRoute(server, {
      name: "second",
      matches: (p) => p.startsWith("/x"),
      handle: ((_r: unknown, s: { write: (v: string) => void }) => { hit.push("second"); accept("second")(_r, s); }) as never,
    });
    await tryUpgrade(port, "/xyz");
    expect(hit).toEqual(["first"]);
  });

  test("注销后不再被调用,该路径回落 404", async () => {
    const { server, port } = await listen();
    const off = registerUpgradeRoute(server, { name: "a", matches: (p) => p.startsWith("/a"), handle: accept("a") as never });
    expect(await tryUpgrade(port, "/a1")).toBe("101");
    off();
    expect(await tryUpgrade(port, "/a1")).toBe("http-404");
  });

  test("注销幂等,重复调用不抛", async () => {
    const { server } = await listen();
    const off = registerUpgradeRoute(server, { name: "a", matches: () => true, handle: accept("a") as never });
    off();
    expect(() => off()).not.toThrow();
  });

  test("upgradeRouteNames 按注册顺序返回,注销后剔除", async () => {
    const { server } = await listen();
    registerUpgradeRoute(server, { name: "a", matches: () => false, handle: accept("a") as never });
    const offB = registerUpgradeRoute(server, { name: "b", matches: () => false, handle: accept("b") as never });
    expect(upgradeRouteNames(server)).toEqual(["a", "b"]);
    offB();
    expect(upgradeRouteNames(server)).toEqual(["a"]);
  });

  test("matches 抛异常时视为不匹配,继续试下一条,服务器不崩", async () => {
    const { server, port } = await listen();
    registerUpgradeRoute(server, {
      name: "boom",
      matches: () => { throw new Error("坏路由"); },
      handle: accept("boom") as never,
    });
    registerUpgradeRoute(server, { name: "good", matches: (p) => p.startsWith("/g"), handle: accept("good") as never });
    expect(await tryUpgrade(port, "/g1")).toBe("101");
  });

  test("handle 抛异常时销毁 socket 而不是让服务器崩", async () => {
    const { server, port } = await listen();
    registerUpgradeRoute(server, {
      name: "throws",
      matches: () => true,
      handle: (() => { throw new Error("处理器炸了"); }) as never,
    });
    const outcome = await tryUpgrade(port, "/anything");
    expect(outcome).not.toBe("timeout");
    expect(await tryUpgrade(port, "/again")).not.toBe("timeout");
  });

  test("query 串不参与匹配", async () => {
    const { server, port } = await listen();
    registerUpgradeRoute(server, { name: "a", matches: (p) => p === "/a", handle: accept("a") as never });
    expect(await tryUpgrade(port, "/a?token=zzz")).toBe("101");
  });

  test("两台 server 的路由表互不串", async () => {
    const s1 = await listen();
    const s2 = await listen();
    registerUpgradeRoute(s1.server, { name: "only-on-s1", matches: () => true, handle: accept("a") as never });
    expect(upgradeRouteNames(s1.server)).toEqual(["only-on-s1"]);
    expect(upgradeRouteNames(s2.server)).toEqual([]);
  });
});