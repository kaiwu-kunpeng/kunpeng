import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startDashboard } from "../../src/server/http.js";
import { deriveAccountId, hashPassword, signSession, writeAuthConfig, type AuthConfig } from "../../src/server/auth.js";
import { applySecurityHeaders } from "../../src/server/security-headers.js";

const SECRET = "sec-security-headers";
const ACCOUNT_ID = deriveAccountId(SECRET, "s1");
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kp-sec-headers-"));
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

async function withServer(fn: (port: number) => Promise<void>): Promise<void> {
  const server = await startDashboard({ port: 0, stateDir: dir, repoRoot: dir });
  try {
    await fn(server.port);
  } finally {
    await server.close();
  }
}

function expectBaseline(r: Response, label: string): void {
  expect(r.headers.get("x-content-type-options"), label).toBe("nosniff");
  expect(r.headers.get("x-frame-options"), label).toBe("SAMEORIGIN");
  expect(r.headers.get("referrer-policy"), label).toBe("same-origin");
  const csp = r.headers.get("content-security-policy") ?? "";
  expect(csp, label).toContain("frame-ancestors 'self'");
  expect(csp, label).toContain("object-src 'none'");
  expect(csp, label).toContain("base-uri 'self'");
  // 驾驶舱与登录页依赖内联脚本，文件预览会渲染任意 HTML：本流不收紧脚本来源
  expect(csp, label).not.toContain("script-src");
  expect(csp, label).not.toContain("default-src");
}

describe("驾驶舱统一安全响应头（作者锁定）", () => {
  it("登录页、未登录重定向、未登录 API、/healthz 都带基线安全头", async () => {
    await withServer(async (port) => {
      const base = `http://127.0.0.1:${port}`;
      const login = await fetch(`${base}/login`, { redirect: "manual" });
      expect(login.status).toBe(200);
      expectBaseline(login, "/login");

      const home = await fetch(`${base}/`, { redirect: "manual", headers: { "x-forwarded-for": "203.0.113.5" } });
      expect(home.status).toBe(302);
      expectBaseline(home, "/ 302");

      const api = await fetch(`${base}/api/flows`, { redirect: "manual", headers: { "x-forwarded-for": "203.0.113.5" } });
      expect(api.status).toBe(401);
      expectBaseline(api, "/api 401");

      const health = await fetch(`${base}/healthz`, { redirect: "manual" });
      expectBaseline(health, "/healthz");
    });
  });

  it("登录后的驾驶舱首页同样带头，且内联脚本仍在页面里（未被 CSP 拦掉的前提）", async () => {
    await withServer(async (port) => {
      const tok = signSession(ACCOUNT_ID, "home", SECRET, Date.now());
      const r = await fetch(`http://127.0.0.1:${port}/`, { headers: { cookie: `kp_session=${tok}` } });
      expect(r.status).toBe(200);
      expectBaseline(r, "/ 已登录");
      expect(await r.text()).toContain("<script");
    });
  });

  it("HSTS 只在 https 请求（经隧道 x-forwarded-proto=https）上发", async () => {
    await withServer(async (port) => {
      const base = `http://127.0.0.1:${port}`;
      const plain = await fetch(`${base}/login`, { redirect: "manual" });
      expect(plain.headers.get("strict-transport-security")).toBeNull();

      const viaTunnel = await fetch(`${base}/login`, {
        redirect: "manual",
        headers: { "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.5" },
      });
      const hsts = viaTunnel.headers.get("strict-transport-security") ?? "";
      const m = /max-age=(\d+)/.exec(hsts);
      expect(m, "https 请求必须带 HSTS max-age").not.toBeNull();
      expect(Number(m?.[1])).toBeGreaterThanOrEqual(15552000);
      expectBaseline(viaTunnel, "/login https");
    });
  });

  it("applySecurityHeaders 是纯函数式写头：只写入 res，不改状态码", () => {
    const headers = new Map<string, string>();
    const res = { statusCode: 200, setHeader: (k: string, v: string) => { headers.set(k.toLowerCase(), v); } };
    applySecurityHeaders({ headers: { "x-forwarded-proto": "https" } } as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("strict-transport-security")).toMatch(/max-age=\d+/);
    headers.clear();
    applySecurityHeaders({ headers: {} } as never, res as never);
    expect(headers.has("strict-transport-security")).toBe(false);
  });
});