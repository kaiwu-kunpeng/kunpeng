import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startDashboard } from "../../src/server/http.js";
import { deriveAccountId, hashPassword, signSession, writeAuthConfig, type AuthConfig } from "../../src/server/auth.js";

const SECRET = "sec-healthz-public";
const ACCOUNT_ID = deriveAccountId(SECRET, "s1");
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kp-healthz-public-"));
  const cfg: AuthConfig = {
    secret: SECRET,
    accounts: [{ id: ACCOUNT_ID, username: "admin", salt: "s1", hash: hashPassword("pw", "s1"), profileId: "home", role: "owner", updatedAt: 1 }],
  };
  await writeAuthConfig(dir, cfg);
});
afterEach(async () => {
  await chmod(dir, 0o700).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

/** 异步跑探针（server 与测试同进程，同步子进程会卡死事件循环）。返回退出码。 */
function runProbe(script: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["-e", script], { stdio: "ignore" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function withServer(fn: (port: number) => Promise<void>): Promise<void> {
  const server = await startDashboard({ port: 0, stateDir: dir, repoRoot: dir });
  try {
    await fn(server.port);
  } finally {
    server.close();
  }
}

/** 取出 Dockerfile 里 HEALTHCHECK 的 node -e 探针脚本，端口换成测试 server 的端口。 */
async function dockerProbeScript(port: number): Promise<string> {
  const dockerfile = await readFile(join(process.cwd(), "..", "Dockerfile"), "utf8");
  const flat = dockerfile.replace(/\\\n/g, " ");
  const line = flat.split("\n").find((l) => l.trimStart().startsWith("HEALTHCHECK"));
  expect(line, "Dockerfile 必须有 HEALTHCHECK").toBeDefined();
  const m = /node -e "(.*)"\s*$/.exec(line ?? "");
  expect(m, "HEALTHCHECK 应是 node -e 探针").not.toBeNull();
  return (m?.[1] ?? "").replace(/127\.0\.0\.1:7777/g, `127.0.0.1:${port}`);
}

describe("/healthz 未登录可探活、只给 ok（作者锁定）", () => {
  it("未登录 GET /healthz：200 或 503，响应体只有 ok 一个键", async () => {
    await withServer(async (port) => {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`, { redirect: "manual" });
      expect([200, 503]).toContain(r.status);
      const body = (await r.json()) as Record<string, unknown>;
      expect(Object.keys(body)).toEqual(["ok"]);
      expect(body.ok).toBe(r.status === 200);
    });
  });

  it("伪造/过期 cookie 按未登录处理：同样只有 ok", async () => {
    await withServer(async (port) => {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`, { redirect: "manual", headers: { cookie: "kp_session=forged.token" } });
      expect([200, 503]).toContain(r.status);
      expect(Object.keys((await r.json()) as Record<string, unknown>)).toEqual(["ok"]);
    });
  });

  it("登录后 GET /healthz 仍给完整检查项", async () => {
    await withServer(async (port) => {
      const tok = signSession(ACCOUNT_ID, "home", SECRET, Date.now());
      const r = await fetch(`http://127.0.0.1:${port}/healthz`, { headers: { cookie: `kp_session=${tok}` } });
      expect([200, 503]).toContain(r.status);
      const body = (await r.json()) as { ok: boolean; checks?: unknown[] };
      expect(Array.isArray(body.checks)).toBe(true);
    });
  });

  it("其它路径鉴权不变：未登录 GET /api/state 401、POST /healthz 不放行", async () => {
    await withServer(async (port) => {
      const state = await fetch(`http://127.0.0.1:${port}/api/state`, { redirect: "manual" });
      expect(state.status).toBe(401);
      const post = await fetch(`http://127.0.0.1:${port}/healthz`, { method: "POST", redirect: "manual" });
      expect([200, 503]).not.toContain(post.status);
      expect(post.status).toBe(302);
      expect(post.headers.get("location")).toBe("/login");
    });
  });

  it.skipIf(process.getuid?.() === 0)("Dockerfile HEALTHCHECK 探 /healthz：健康时退出 0，状态目录不可写时退出非 0", async () => {
    await withServer(async (port) => {
      const script = await dockerProbeScript(port);
      expect(await runProbe(script)).toBe(0);
      await chmod(dir, 0o500);
      const sick = await fetch(`http://127.0.0.1:${port}/healthz`, { redirect: "manual" });
      expect(sick.status).toBe(503);
      expect(await sick.json()).toEqual({ ok: false });
      expect(await runProbe(script)).not.toBe(0);
    });
  });
});