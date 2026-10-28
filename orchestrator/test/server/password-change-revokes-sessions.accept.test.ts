import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addAccount,
  editAccount,
  readAuthConfig,
  signSession,
  verifySession,
  writeAuthConfig,
  type AuthConfig,
} from "../../src/server/auth.js";
import { changePassword } from "../../src/server/auth-change.js";
import { authorizeRequest, RESTRICTED_POLICY } from "../../src/server/authz.js";
import { startDashboard } from "../../src/server/http.js";

const T0 = 1_800_000_000_000;
const DAY = 24 * 3600 * 1000;
const dirs: string[] = [];

async function tempState(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kp-pwd-revoke-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function seed(): AuthConfig {
  const empty: AuthConfig = { secret: "sec", accounts: [] };
  const withOwner = addAccount(empty, { username: "admin", password: "old-password", profileId: "home", role: "owner", salt: "s1", now: T0 });
  return addAccount(withOwner, { username: "bob", password: "bob-password", profileId: "home", role: "member", salt: "s2", now: T0 });
}

function accountId(cfg: AuthConfig, username: string): string {
  const id = cfg.accounts.find((a) => a.username === username)?.id;
  if (!id) throw new Error(`no id for ${username}`);
  return id;
}

function check(cfg: AuthConfig, token: string, now: number) {
  const session = verifySession(token, cfg.secret, now, 7 * DAY);
  expect(session).not.toBeNull();
  return authorizeRequest(session!, cfg.accounts, "/api/state", RESTRICTED_POLICY, "GET").ok;
}

describe("改密码后此前签发的会话失效（作者锁定）", () => {
  it("changePassword：旧会话被拒，改密码之后签发的新会话可用，别的账号不受影响", async () => {
    const dir = await tempState();
    await writeAuthConfig(dir, seed());
    const before = (await readAuthConfig(dir))!;
    const adminId = accountId(before, "admin");
    const oldToken = signSession(adminId, "home", before.secret, T0 + 1000);
    const bobToken = signSession(accountId(before, "bob"), "home", before.secret, T0 + 1000);
    expect(check(before, oldToken, T0 + 2000)).toBe(true);

    const r = await changePassword(dir, { username: "admin", currentPassword: "old-password", newPassword: "new-password-1" }, { salt: "s9", now: T0 + 5000 });
    expect(r).toEqual({ ok: true });

    const after = (await readAuthConfig(dir))!;
    expect(after.accounts.find((a) => a.username === "admin")?.passwordChangedAt).toBe(T0 + 5000);
    expect(check(after, oldToken, T0 + 6000)).toBe(false);
    expect(check(after, signSession(adminId, "home", after.secret, T0 + 5000), T0 + 6000)).toBe(true);
    expect(check(after, signSession(adminId, "home", after.secret, T0 + 5500), T0 + 6000)).toBe(true);
    expect(check(after, bobToken, T0 + 6000)).toBe(true);
  });

  it("editAccount 重置密码同样让旧会话失效；只改角色或 hostCeiling 不踢人", () => {
    const cfg = seed();
    const bobId = accountId(cfg, "bob");
    const oldToken = signSession(bobId, "home", cfg.secret, T0 + 1000);

    const ceilingOnly = editAccount(cfg, { username: "bob", hostCeiling: "readonly", now: T0 + 3000 });
    const roleOnly = editAccount(ceilingOnly, { username: "bob", role: "owner", now: T0 + 4000 });
    expect(roleOnly.accounts.find((a) => a.username === "bob")?.passwordChangedAt).toBeUndefined();
    expect(check(roleOnly, oldToken, T0 + 4500)).toBe(true);

    const reset = editAccount(roleOnly, { username: "bob", newPassword: "reset-password", salt: "s7", now: T0 + 5000 });
    expect(reset.accounts.find((a) => a.username === "bob")?.passwordChangedAt).toBe(T0 + 5000);
    expect(check(reset, oldToken, T0 + 6000)).toBe(false);
    expect(check(reset, signSession(bobId, "home", reset.secret, T0 + 6000), T0 + 6000)).toBe(true);
  });

  it("老账号没有 passwordChangedAt 字段：旧会话照常可用", async () => {
    const dir = await tempState();
    const legacy = seed();
    for (const a of legacy.accounts) expect("passwordChangedAt" in a).toBe(false);
    await writeAuthConfig(dir, legacy);
    const cfg = (await readAuthConfig(dir))!;
    expect(check(cfg, signSession(accountId(cfg, "admin"), "home", cfg.secret, T0 + 1), T0 + 6 * DAY)).toBe(true);
  });

  it("真 server：改密码前拿到的 cookie 改密码后 401，重新登录的 cookie 200", async () => {
    const dir = await tempState();
    const empty: AuthConfig = { secret: "sec", accounts: [] };
    await writeAuthConfig(dir, addAccount(empty, { username: "admin", password: "old-password", profileId: "home", role: "owner", salt: "s1", now: Date.now() - 60_000 }));
    const server = await startDashboard({ port: 0, stateDir: dir });
    const base = `http://127.0.0.1:${server.port}`;
    const login = async (password: string) => {
      const res = await fetch(`${base}/api/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password }),
      });
      expect(res.status).toBe(200);
      return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    };
    const state = async (cookie: string) => (await fetch(`${base}/api/state`, { headers: { cookie } })).status;
    try {
      const oldCookie = await login("old-password");
      expect(await state(oldCookie)).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 5));

      const change = await fetch(`${base}/api/auth/change-password`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: oldCookie },
        body: JSON.stringify({ currentPassword: "old-password", newPassword: "new-password-1" }),
      });
      expect(await change.json()).toEqual({ ok: true });

      expect(await state(oldCookie)).toBe(401);
      const newCookie = await login("new-password-1");
      expect(await state(newCookie)).toBe(200);
    } finally {
      await server.close();
    }
  });
});