import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationStore } from "../../src/chat/conversation-store.js";
import {
  addAccount,
  buildAuthConfig,
  deleteAccount,
  editAccount,
  hashPassword,
  readAuthConfig,
  signSession,
  verifySession,
  writeAuthConfig,
  type AuthConfig,
} from "../../src/server/auth.js";
import { requestAuthContext, currentConversationOwner } from "../../src/server/auth-context.js";
import { authorizeRequest } from "../../src/server/authz.js";
import { startDashboard } from "../../src/server/http.js";

const roots: string[] = [];

function temp(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  roots.push(path);
  return path;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function storeAt(stateDir: string, ids: string[] = ["conv-old"]): ConversationStore {
  return new ConversationStore(join(stateDir, "chat"), {
    now: () => 1000,
    id: () => ids.shift() ?? "conv-extra",
  });
}

function legacyToken(username: string, profileId: string, secret: string, at: number): string {
  const payload = `${username}.${profileId}.${at}`;
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

async function login(port: number, username: string, password: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  expect(response.status).toBe(200);
  const body = await response.json() as { ok?: boolean };
  expect(body.ok).toBe(true);
  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  return (setCookie ?? "").split(";")[0] ?? "";
}

describe("不可变 accountId 与 v2 session", () => {
  it("改名保持 id；删除后同名重建产生新 id，旧 token 被拒绝", () => {
    let cfg = buildAuthConfig("root", "root-pw", { salt: "root-salt", secret: "secret", now: 1 });
    cfg = addAccount(cfg, {
      username: "bob",
      password: "old-pw",
      profileId: "home",
      role: "member",
      salt: "bob-old-salt",
      now: 2,
    });
    const old = cfg.accounts.find((account) => account.username === "bob");
    expect(old?.id).toMatch(/^[0-9a-f]{16,}$/);
    const oldId = old?.id ?? "";
    const token = signSession(oldId, "home", cfg.secret, 1000);
    expect(token).not.toContain("bob");
    expect(verifySession(token, cfg.secret, 1001, 10000)?.accountId).toBe(oldId);

    const renamed = editAccount(cfg, { username: "bob", newUsername: "bobby", now: 3 });
    expect(renamed.accounts.find((account) => account.username === "bobby")?.id).toBe(oldId);
    const renamedSession = verifySession(token, cfg.secret, 1001, 10000);
    expect(renamedSession && authorizeRequest(renamedSession, renamed.accounts, "/api/conversations")).toMatchObject({
      ok: true,
      accountId: oldId,
      username: "bobby",
    });

    const removed = deleteAccount(renamed, "bobby");
    const reused = addAccount(removed, {
      username: "bob",
      password: "new-pw",
      profileId: "home",
      role: "member",
      salt: "bob-new-salt",
      now: 4,
    });
    const newId = reused.accounts.find((account) => account.username === "bob")?.id;
    expect(newId).toBeTruthy();
    expect(newId).not.toBe(oldId);
    expect(renamedSession && authorizeRequest(renamedSession, reused.accounts, "/api/conversations")).toEqual({ ok: false, status: 401 });
  });

  it("旧四段 username token 强制失效；有鉴权上下文缺 accountId 时 fail-closed", () => {
    expect(verifySession(legacyToken("bob", "home", "secret", 1000), "secret", 1001, 10000)).toBeNull();
    expect(currentConversationOwner()).toBe("local");
    expect(() => requestAuthContext.run(
      { username: "bob", profileId: "home", role: "member" },
      () => currentConversationOwner(),
    )).toThrow(/accountId/i);
    expect(requestAuthContext.run(
      { accountId: "acct-1", username: "bob", profileId: "home", role: "member" },
      () => currentConversationOwner(),
    )).toBe("acct-1");
  });
});

describe("用户名目录迁移与同名复用隔离", () => {
  it("migrateOwner 可恢复地迁移旧会话，旧 namespace 与新同名账号均读不到", async () => {
    const stateDir = temp("kp-chat-owner-migrate-");
    const store = storeAt(stateDir);
    const legacy = await store.create("bob", { model: "claude-opus-5", projectId: "kunpeng" });
    await store.appendTurns("bob", legacy.id, [
      { role: "user", text: "OLD-BOB-SECRET-42" },
      { role: "assistant", text: "收到" },
    ]);

    await store.migrateOwner("bob", "acct-old-bob");
    await store.migrateOwner("bob", "acct-old-bob");

    expect((await store.get("acct-old-bob", legacy.id))?.turns[0]?.text).toBe("OLD-BOB-SECRET-42");
    expect(await store.get("bob", legacy.id)).toBeNull();
    expect(await store.list("acct-new-bob")).toEqual([]);
    expect(existsSync(join(stateDir, "chat", ".migrated"))).toBe(true);
  });

  it("真 HTTP：旧账号升级后能读旧对话，新同名账号重启后列表为空", async () => {
    const repo = temp("kp-chat-owner-repo-");
    const stateDir = temp("kp-chat-owner-state-");
    mkdirSync(stateDir, { recursive: true });
    const secret = "legacy-secret";
    const oldPassword = "old-password";
    const oldSalt = "legacy-bob-salt";
    const rawLegacy: AuthConfig = {
      secret,
      accounts: [{
        username: "bob",
        salt: oldSalt,
        hash: hashPassword(oldPassword, oldSalt),
        profileId: "home",
        role: "owner",
        updatedAt: 1,
      }],
    };
    writeFileSync(join(stateDir, "auth.json"), `${JSON.stringify(rawLegacy, null, 2)}\n`, "utf8");
    const legacyStore = storeAt(stateDir, ["conv-http-old"]);
    const oldConversation = await legacyStore.create("bob", { model: "claude-opus-5", projectId: "kunpeng" });
    await legacyStore.appendTurns("bob", oldConversation.id, [
      { role: "user", text: "HTTP-OLD-SECRET" },
      { role: "assistant", text: "收到" },
    ]);

    const first = await startDashboard({ port: 0, repoRoot: repo, stateDir });
    try {
      const cookie = await login(first.port, "bob", oldPassword);
      const response = await fetch(`http://127.0.0.1:${first.port}/api/conversations/${oldConversation.id}`, {
        headers: { cookie },
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("HTTP-OLD-SECRET");
    } finally {
      first.close();
    }

    const migrated = await readAuthConfig(stateDir);
    const oldId = migrated?.accounts[0]?.id;
    expect(oldId).toBeTruthy();
    expect(migrated?.accounts[0]?.legacyConversationOwner).toBeUndefined();

    const replacement = buildAuthConfig("bob", "new-password", {
      salt: "replacement-bob-salt",
      secret,
      now: 2,
    });
    expect(replacement.accounts[0]?.id).not.toBe(oldId);
    await writeAuthConfig(stateDir, replacement);

    const second = await startDashboard({ port: 0, repoRoot: repo, stateDir });
    try {
      const cookie = await login(second.port, "bob", "new-password");
      const response = await fetch(`http://127.0.0.1:${second.port}/api/conversations`, { headers: { cookie } });
      expect(response.status).toBe(200);
      const list = await response.json() as unknown[];
      expect(list).toEqual([]);
    } finally {
      second.close();
    }

    const authDisk = JSON.parse(readFileSync(join(stateDir, "auth.json"), "utf8")) as AuthConfig;
    expect(authDisk.accounts[0]?.id).toBe(replacement.accounts[0]?.id);
  });
});