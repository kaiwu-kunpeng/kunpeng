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

describe("PATCH /api/accounts 路由（编辑账号）", () => {
  it("member 无权 / owner 改名落盘 / 改名碰撞拒 / 降级最后owner拒 / 重置密码可用新密码登录", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-acct-edit-"));
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
    const patch = (cookie: string, payload: Record<string, unknown>) =>
      jsonFetch(base, "/api/accounts", {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(payload),
      });
    try {
      const login = async (u: string, p: string) =>
        jsonFetch(base, "/api/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: u, password: p }),
        });
      const adminCookie = (await login("admin", "pw")).cookie;
      const bobCookie = (await login("bob", "pw")).cookie;

      // member 无权编辑账号 → 403
      const memberEdit = await patch(bobCookie, { username: "bob", newUsername: "x" });
      expect(memberEdit.status).toBe(403);

      // owner 把 bob 改名为 bobby → 200，且落盘
      const rename = await patch(adminCookie, { username: "bob", newUsername: "bobby" });
      expect(rename.status).toBe(200);
      const afterRename = await readAuthConfig(dir);
      expect(afterRename?.accounts.some((a) => a.username === "bobby")).toBe(true);
      expect(afterRename?.accounts.some((a) => a.username === "bob")).toBe(false);

      // 改名碰撞已存在的 admin → 400
      const collide = await patch(adminCookie, { username: "bobby", newUsername: "admin" });
      expect(collide.status).toBe(400);

      // 把最后一个 owner(admin) 降级为 member → 400
      const demote = await patch(adminCookie, { username: "admin", role: "member" });
      expect(demote.status).toBe(400);

      // 重置 bobby 的密码为 newpw → 200，且能用新密码登录、旧密码失败
      const reset = await patch(adminCookie, { username: "bobby", newPassword: "newpw" });
      expect(reset.status).toBe(200);
      expect((await login("bobby", "newpw")).status).toBe(200);
      expect((await login("bobby", "pw")).status).toBe(401);
    } finally {
      server.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
