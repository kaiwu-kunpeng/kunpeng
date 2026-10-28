import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startDashboard } from "../../src/server/http.js";
import { hashPassword, writeAuthConfig, readAuthConfig, type AuthConfig } from "../../src/server/auth.js";

async function jsonFetch(base: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  const body = (() => {
    try {
      return text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  })();
  return { status: res.status, cookie: res.headers.get("set-cookie") ?? "", body };
}

describe("DELETE /api/accounts 路由", () => {
  it("member 无权 / 删自己拒 / 删不存在拒 / owner 删 member 成功并落盘", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-acct-del-"));
    const cfg: AuthConfig = {
      secret: "sec",
      accounts: [
        { username: "admin", salt: "s1", hash: hashPassword("pw", "s1"), profileId: "home", role: "owner", updatedAt: 1 },
        { username: "bob", salt: "s2", hash: hashPassword("pw", "s2"), profileId: "home", role: "member", updatedAt: 1 },
      ],
    };
    await writeAuthConfig(dir, cfg);

    const server = await startDashboard({ port: 0, stateDir: dir });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const login = async (u: string) =>
        jsonFetch(base, "/api/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: u, password: "pw" }),
        });
      const adminCookie = (await login("admin")).cookie;
      const bobCookie = (await login("bob")).cookie;

      // member 无权管理账号 → 403
      const memberDel = await jsonFetch(base, "/api/accounts?username=admin", { method: "DELETE", headers: { cookie: bobCookie } });
      expect(memberDel.status).toBe(403);

      // owner 删自己 → 400
      const delSelf = await jsonFetch(base, "/api/accounts?username=admin", { method: "DELETE", headers: { cookie: adminCookie } });
      expect(delSelf.status).toBe(400);

      // owner 删不存在的账号 → 400（deleteAccount 抛错被路由 catch）
      const delGhost = await jsonFetch(base, "/api/accounts?username=ghost", { method: "DELETE", headers: { cookie: adminCookie } });
      expect(delGhost.status).toBe(400);

      // owner 删 member → 200，且 auth.json 落盘后不再含 bob
      const delBob = await jsonFetch(base, "/api/accounts?username=bob", { method: "DELETE", headers: { cookie: adminCookie } });
      expect(delBob.status).toBe(200);
      expect(delBob.body.ok).toBe(true);
      expect((delBob.body.accounts as { username: string }[]).some((a) => a.username === "bob")).toBe(false);

      const after = await readAuthConfig(dir);
      expect(after?.accounts.some((a) => a.username === "bob")).toBe(false);
    } finally {
      server.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("即使存在其他 owner，也不能删除自己（自删守卫，独立于最后owner守卫）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-acct-self-"));
    const cfg: AuthConfig = {
      secret: "sec",
      accounts: [
        { username: "admin", salt: "s1", hash: hashPassword("pw", "s1"), profileId: "home", role: "owner", updatedAt: 1 },
        { username: "admin2", salt: "s2", hash: hashPassword("pw", "s2"), profileId: "home", role: "owner", updatedAt: 1 },
      ],
    };
    await writeAuthConfig(dir, cfg);

    const server = await startDashboard({ port: 0, stateDir: dir });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const adminCookie = (await jsonFetch(base, "/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "pw" }),
      })).cookie;

      // 还有 admin2 这个 owner，最后owner守卫不会触发；必须由自删守卫拦下 → 400
      const delSelf = await jsonFetch(base, "/api/accounts?username=admin", { method: "DELETE", headers: { cookie: adminCookie } });
      expect(delSelf.status).toBe(400);

      // admin 仍在（没被删掉）
      const after = await readAuthConfig(dir);
      expect(after?.accounts.some((a) => a.username === "admin")).toBe(true);
    } finally {
      server.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
