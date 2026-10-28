import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startDashboard } from "../../src/server/http.js";
import { deriveAccountId, hashPassword, writeAuthConfig, type AuthConfig } from "../../src/server/auth.js";
import { createLoginLimiter, resolveLoginClientIp } from "../../src/server/login-limiter.js";

const SECRET = "sec-login-client-ip";
const ACCOUNT_ID = deriveAccountId(SECRET, "s1");
const dirs: string[] = [];

async function makeStateDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kp-login-ip-"));
  dirs.push(dir);
  const cfg: AuthConfig = {
    secret: SECRET,
    accounts: [{ id: ACCOUNT_ID, username: "admin", salt: "s1", hash: hashPassword("right-pw", "s1"), profileId: "home", role: "owner", updatedAt: 1 }],
  };
  await writeAuthConfig(dir, cfg);
  return dir;
}

beforeEach(() => { dirs.length = 0; });
afterEach(async () => {
  for (const dir of dirs) {
    await chmod(dir, 0o700).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

async function withServer(dir: string, fn: (base: string) => Promise<void>): Promise<void> {
  const server = await startDashboard({ port: 0, stateDir: dir, repoRoot: dir });
  try {
    await fn(`http://127.0.0.1:${server.port}`);
  } finally {
    await server.close();
  }
}

/** 模拟经 cloudflared 隧道进来的登录：socket 是本机回环，真实客户端 IP 在 cf-connecting-ip。 */
function tunnelLogin(base: string, clientIp: string, password: string): Promise<Response> {
  return fetch(`${base}/api/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": clientIp,
      "x-forwarded-for": clientIp,
      "x-forwarded-proto": "https",
    },
    body: JSON.stringify({ username: "admin", password }),
  });
}

describe("登录限速按真实客户端 IP 计数（作者锁定）", () => {
  it("攻击者从一个 IP 连错 5 次被锁，owner 从另一个 IP 用正确密码照常登录", async () => {
    const dir = await makeStateDir();
    await withServer(dir, async (base) => {
      for (let i = 0; i < 5; i++) expect((await tunnelLogin(base, "203.0.113.9", "wrong")).status).toBe(401);
      expect((await tunnelLogin(base, "203.0.113.9", "wrong")).status).toBe(429);
      expect((await tunnelLogin(base, "203.0.113.9", "right-pw")).status).toBe(429);
      expect((await tunnelLogin(base, "198.51.100.7", "right-pw")).status).toBe(200);
    });
  });

  it("失败计数按 stateDir 落盘：服务重启后锁定仍在，且不同 stateDir 互不影响", async () => {
    const dirA = await makeStateDir();
    const dirB = await makeStateDir();
    await withServer(dirA, async (base) => {
      for (let i = 0; i < 5; i++) await tunnelLogin(base, "203.0.113.20", "wrong");
    });
    const st = await stat(join(dirA, "login-limiter.json"));
    expect(st.mode & 0o077, "计数文件只对本人可读写").toBe(0);
    await withServer(dirA, async (base) => {
      expect((await tunnelLogin(base, "203.0.113.20", "wrong")).status).toBe(429);
    });
    await withServer(dirB, async (base) => {
      expect((await tunnelLogin(base, "203.0.113.20", "wrong")).status).toBe(401);
    });
  });
});

describe("resolveLoginClientIp：只在 socket 是本机回环时信任 cf-connecting-ip", () => {
  it("回环 socket + cf-connecting-ip → 取头里的 IP", () => {
    expect(resolveLoginClientIp({ remoteAddress: "127.0.0.1", cfConnectingIp: "203.0.113.9" })).toBe("203.0.113.9");
    expect(resolveLoginClientIp({ remoteAddress: "::1", cfConnectingIp: "203.0.113.9" })).toBe("203.0.113.9");
    expect(resolveLoginClientIp({ remoteAddress: "::ffff:127.0.0.1", cfConnectingIp: "203.0.113.9" })).toBe("203.0.113.9");
  });
  it("非回环 socket 伪造 cf-connecting-ip → 忽略头，用 socket 地址", () => {
    expect(resolveLoginClientIp({ remoteAddress: "192.168.8.20", cfConnectingIp: "203.0.113.9" })).toBe("192.168.8.20");
  });
  it("回环但没有头 → 用 socket 地址；什么都没有 → 空串", () => {
    expect(resolveLoginClientIp({ remoteAddress: "127.0.0.1" })).toBe("127.0.0.1");
    expect(resolveLoginClientIp({})).toBe("");
  });
});

describe("createLoginLimiter({ persistPath })：同一文件的两个实例共享计数", () => {
  it("实例一记满失败，实例二读到锁定；成功登录清零也落盘", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-limiter-persist-"));
    dirs.push(dir);
    const persistPath = join(dir, "login-limiter.json");
    const now = Date.now();
    const a = createLoginLimiter({ persistPath });
    for (let i = 0; i < 5; i++) a.recordFail("admin|203.0.113.30", now);
    const b = createLoginLimiter({ persistPath });
    expect(b.check("admin|203.0.113.30", now + 1).allowed).toBe(false);
    b.recordSuccess("admin|203.0.113.30");
    const c = createLoginLimiter({ persistPath });
    expect(c.check("admin|203.0.113.30", now + 2).allowed).toBe(true);
  });

  it("计数文件损坏时不抛错，按空计数启动", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-limiter-corrupt-"));
    dirs.push(dir);
    const persistPath = join(dir, "login-limiter.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(persistPath, "{not json");
    const l = createLoginLimiter({ persistPath });
    expect(l.check("admin|203.0.113.31", Date.now()).allowed).toBe(true);
  });
});