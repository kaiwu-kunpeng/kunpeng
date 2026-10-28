// 回归测试:localfs 桥的「穿透鉴权门」串线。
//
// 【层级说明】本文件起真 HTTP 服务 + spawn 真 node 子进程,按 vitest.config.ts 既有政策归 e2e 层
// (*.e2e.test.ts 默认排除,KP_E2E=1 显式触发;并发负载下的 unit 套件不再被它 flaky 击穿)。
//
// 根因复盘:cockpit 开启鉴权后,/api/localfs/* 走 decideAuth,任何无 kp_session cookie 的
// /api/* 一律 401。MCP server 是 claude 本机 spawn 的子进程、自身没有会话,enqueue 时不带
// cookie → 401 → op 进不了队列 → 浏览器永远 poll 不到 → 「没办法穿透」。
// 当初的单测只直接调 handleLocalFsRoute(queue, ...),绕过了整条 HTTP + 鉴权中间件,所以全绿却没接通。
//
// 本测试补两件事:
//   ① localfs 路由确实被 decideAuth 治理(无 cookie 401 / 有效会话 204)—— 走真实 startDashboard。
//   ② 真实 mcp-server 子进程 enqueue 时会带上 KP_LOCALFS_TOKEN 作为 kp_session cookie。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startDashboard } from "../../src/server/http.js";
import { deriveAccountId, hashPassword, signSession, writeAuthConfig, type AuthConfig } from "../../src/server/auth.js";

const SECRET = "sec-localfs-bridge";
const ACCOUNT_ID = deriveAccountId(SECRET, "s1");
const KP_E2E = process.env.KP_E2E === "1";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kp-localfs-auth-"));
  const cfg: AuthConfig = {
    secret: SECRET,
    accounts: [{ id: ACCOUNT_ID, username: "admin", salt: "s1", hash: hashPassword("pw", "s1"), profileId: "home", role: "owner", updatedAt: 1 }],
  };
  await writeAuthConfig(dir, cfg);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe.runIf(KP_E2E)("localfs 桥穿透鉴权门", () => {
  it("①鉴权开启时 /api/localfs/poll:无 cookie→401,有效会话 cookie→204(路由确实在鉴权门后)", async () => {
    const server = await startDashboard({ port: 0, stateDir: dir, repoRoot: dir });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const noCookie = await fetch(`${base}/api/localfs/poll?conv=c1`);
      expect(noCookie.status).toBe(401); // 这正是 MCP 子进程没凭证时撞上的 401

      const tok = signSession(ACCOUNT_ID, "home", SECRET, Date.now());
      const withCookie = await fetch(`${base}/api/localfs/poll?conv=c1`, {
        headers: { cookie: `kp_session=${tok}` },
      });
      expect(withCookie.status).toBe(204); // 队列为空但已穿透鉴权门
    } finally {
      server.close();
    }
  }, 30_000);

  it("②真实 mcp-server 子进程 enqueue 时带上 KP_LOCALFS_TOKEN 作为 kp_session cookie", async () => {
    // 捕获服务器:扮演 cockpit 的 enqueue 端点,记录收到的 cookie,并立刻回一个结果。
    let seenCookie: string | undefined;
    const capture = createServer((req: IncomingMessage, res: ServerResponse) => {
      seenCookie = req.headers.cookie;
      req.on("data", () => {});
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ opId: "op-1", ok: true, data: "[]" }));
      });
    });
    await new Promise<void>((r) => capture.listen(0, "127.0.0.1", r));
    const port = (capture.address() as { port: number }).port;
    const enqueueUrl = `http://127.0.0.1:${port}/api/localfs/enqueue`;

    try {
      const child = spawn(process.execPath, [
        "--input-type=module",
        "--eval",
        "import { runLocalFsMcpServer } from './dist/server/localfs/mcp-server.js'; runLocalFsMcpServer().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });",
      ], {
        env: { ...process.env, KP_LOCALFS_ENQUEUE_URL: enqueueUrl, KP_LOCALFS_CONV: "c1", KP_LOCALFS_TOKEN: "tok-xyz" },
        stdio: ["pipe", "pipe", "inherit"],
      });
      const done = new Promise<string>((resolve, reject) => {
        let out = "";
        child.stdout.on("data", (c) => { out += c; if (out.includes("\n")) resolve(out); });
        child.on("error", reject);
        setTimeout(() => reject(new Error("mcp-server 子进程超时未回应")), 30_000);
      });
      // 驱动一次 tools/call(用带真实 path 的 write,否则空 path 会在 enqueue 前被校验拦下、打不到捕获服务器)→ 触发 enqueue
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "localfs_write", arguments: { path: "x.txt", content: "hi" } } })}\n`);
      const out = await done;
      child.kill();

      expect(out).toContain('"id":1');               // 子进程确实回了结果
      expect(seenCookie).toBe("kp_session=tok-xyz");  // 关键:带了会话 cookie → 能过鉴权门
    } finally {
      await new Promise<void>((r) => capture.close(() => r()));
    }
  }, 40_000);
});
