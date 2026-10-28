import { describe, expect, test, afterEach } from "vitest";
import { readFile, mkdtemp } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDashboard } from "../../src/server/http.js";
import { getWorkerEndpoint } from "../../src/server/worker/worker-runtime.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) {
    try { await close(); } catch { /* 清理尽力而为 */ }
  }
});

/**
 * 发一次真的 HTTP upgrade 请求。
 * 不能用 fetch —— 已实测:给 fetch 设 Connection/Upgrade 头会让它直接抛 "fetch failed"。
 */
function rawUpgrade(port: number, path: string): Promise<string> {
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
    setTimeout(() => done("timeout"), 5000);
  });
}

async function boot(): Promise<{ port: number }> {
  const stateDir = await mkdtemp(join(tmpdir(), "kp-worker-wiring-"));
  const started = await startDashboard({ port: 0, host: "127.0.0.1", stateDir } as never);
  closers.push(() => started.close());
  return { port: started.port };
}

describe("http.ts 接线 · 源码结构", () => {
  test("三处接线都在", async () => {
    const source = await readFile(new URL("../../src/server/http.ts", import.meta.url), "utf8");
    expect(source).toContain('import "./routes/worker.js"');
    expect(source).toContain("attachWorkerWebSocket");
    expect(source).toContain("setWorkerEndpoint");
  });

  test("没有绕过唯一路由器自己挂 upgrade", async () => {
    const source = await readFile(new URL("../../src/server/http.ts", import.meta.url), "utf8");
    expect(source).not.toContain('server.on("upgrade"');
  });
});

describe("http.ts 接线 · 真起服务器", () => {
  test("worker 端点已注册进全局持有者", async () => {
    await boot();
    expect(getWorkerEndpoint()).not.toBeNull();
  }, 30_000);

  test("GET /api/worker/machines 可达(不是 404)", async () => {
    const { port } = await boot();
    const res = await fetch(`http://127.0.0.1:${port}/api/worker/machines`);
    expect(res.status).not.toBe(404);
    res.body?.cancel();
  }, 30_000);

  test("worker WS 路径已有路由:握手被端点自己拒(401/403/426/503),不是路由器的 404", async () => {
    const { port } = await boot();
    const outcome = await rawUpgrade(port, "/api/worker/connect");
    expect(outcome).not.toBe("timeout");
    expect(outcome).not.toBe("http-404");
    expect(["http-401", "http-403", "http-426", "http-503"]).toContain(outcome);
  }, 30_000);

  test("pty 的 WebSocket 路径没有被挤掉(仍归 pty 处理,不是 404)", async () => {
    const { port } = await boot();
    const outcome = await rawUpgrade(port, "/api/workspace/nope/pty");
    expect(outcome).not.toBe("timeout");
    expect(outcome).not.toBe("http-404");
  }, 30_000);

  test("完全没人认领的 upgrade 路径才拿 404", async () => {
    const { port } = await boot();
    expect(await rawUpgrade(port, "/api/nobody/claims/this")).toBe("http-404");
  }, 30_000);

  test("close() 之后持有者回到 null,且能正常关完", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "kp-worker-wiring-close-"));
    const started = await startDashboard({ port: 0, host: "127.0.0.1", stateDir } as never);
    expect(getWorkerEndpoint()).not.toBeNull();
    await started.close();
    expect(getWorkerEndpoint()).toBeNull();
  }, 30_000);
});