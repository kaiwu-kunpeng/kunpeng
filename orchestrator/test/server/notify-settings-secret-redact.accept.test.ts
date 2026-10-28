import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deriveAccountId, hashPassword, signSession, writeAuthConfig, type AccountRecord } from "../../src/server/auth.js";
import { capabilityForRoute } from "../../src/server/authz.js";
import { startDashboard } from "../../src/server/http.js";

const secret = "notify-redact-secret";

function account(salt: string, username: string, role: "owner" | "member"): AccountRecord {
  return {
    id: deriveAccountId(secret, salt),
    username,
    salt,
    hash: hashPassword("pw", salt),
    profileId: "home",
    role,
    updatedAt: 1,
  };
}

const owner = account("salt-owner", "owner", "owner");
const member = account("salt-member", "member", "member");

const WX_TOKEN = "AT_wxpusher-app-token-0123456789-WX9Z";
const TG_TOKEN = "123456789:telegram-bot-token-abcdefgh-TG7Q";
const SERVER_CHAN = "SCT-serverchan-sendkey-abcdef-SC5K";
const WECOM = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=wecom-robot-key-abcdef-WC3M";
const FULL_SECRETS = [WX_TOKEN, TG_TOKEN, SERVER_CHAN, WECOM];

const seed = {
  cockpitUrl: "https://cockpit.example.test",
  telegram: { token: TG_TOKEN, chatId: "10001", webhookSecret: "tg-hook-secret-0001" },
  serverChan: SERVER_CHAN,
  wxpusher: { appToken: WX_TOKEN, uid: "UID_demo_0001" },
  wechatWebhook: WECOM,
};

let repo = "";
let stateDir = "";
let home = "";
let prevHome: string | undefined;
let server: { port: number; close: () => Promise<void> };

function cookie(who: AccountRecord): string {
  if (!who.id) throw new Error("Test account must have an immutable id");
  return `kp_session=${signSession(who.id, "home", secret, Date.now())}`;
}

function getNotify(who: AccountRecord): Promise<Response> {
  return fetch(`http://127.0.0.1:${server.port}/api/settings/notify`, { headers: { cookie: cookie(who) } });
}

function postNotify(who: AccountRecord, body: Record<string, unknown>): Promise<Response> {
  return fetch(`http://127.0.0.1:${server.port}/api/settings/notify`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookie(who) },
    body: JSON.stringify(body),
  });
}

function notifyFile(): string {
  return join(home, ".kunpeng", "notify.json");
}

function readSaved(): typeof seed {
  return JSON.parse(readFileSync(notifyFile(), "utf8")) as typeof seed;
}

beforeAll(async () => {
  prevHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), "kp-notify-redact-home-"));
  process.env.HOME = home;
  repo = mkdtempSync(join(tmpdir(), "kp-notify-redact-repo-"));
  stateDir = mkdtempSync(join(tmpdir(), "kp-notify-redact-state-"));
  await writeAuthConfig(stateDir, { secret, accounts: [owner, member] });
  server = await startDashboard({ port: 0, repoRoot: repo, stateDir, execPath: "/usr/bin/false", cliJs: "/nonexistent/cli.js" });
});

beforeEach(() => {
  mkdirSync(join(home, ".kunpeng"), { recursive: true });
  writeFileSync(notifyFile(), JSON.stringify(seed, null, 2), "utf8");
});

afterAll(async () => {
  await server?.close();
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  rmSync(repo, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe("通知设置密钥不外泄", () => {
  it("鉴权表：GET /api/settings/notify 需要 admin", () => {
    expect(capabilityForRoute("/api/settings/notify", "GET")).toBe("admin");
  });

  it("member 读通知设置 → 403，响应里没有任何密钥", async () => {
    const res = await getNotify(member);
    expect(res.status).toBe(403);
    const text = await res.text();
    for (const s of FULL_SECRETS) expect(text).not.toContain(s);
  });

  it("owner 读到的是打码值：不含完整密钥，只露末 4 位；非密钥字段原样返回", async () => {
    const res = await getNotify(owner);
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const s of FULL_SECRETS) expect(text).not.toContain(s);
    const body = JSON.parse(text) as Record<string, string>;
    expect(body.ok).toBe(true);
    expect(body.wxToken.endsWith("WX9Z")).toBe(true);
    expect(body.tgToken.endsWith("TG7Q")).toBe(true);
    expect(body.serverChan.endsWith("SC5K")).toBe(true);
    expect(body.wecom.endsWith("WC3M")).toBe(true);
    expect(body.wxToken.length).toBeLessThan(WX_TOKEN.length);
    expect(body.cockpitUrl).toBe("https://cockpit.example.test");
    expect(body.tgChat).toBe("10001");
    expect(body.wxUid).toBe("UID_demo_0001");
  });

  it("owner 把读到的打码值原样保存回去 → notify.json 里的密钥一个不变", async () => {
    const got = await (await getNotify(owner)).json() as Record<string, unknown>;
    const res = await postNotify(owner, got);
    expect(res.status).toBe(200);
    expect((await res.json() as { ok: boolean }).ok).toBe(true);
    const saved = readSaved();
    expect(saved.wxpusher.appToken).toBe(WX_TOKEN);
    expect(saved.telegram.token).toBe(TG_TOKEN);
    expect(saved.telegram.webhookSecret).toBe("tg-hook-secret-0001");
    expect(saved.serverChan).toBe(SERVER_CHAN);
    expect(saved.wechatWebhook).toBe(WECOM);
    expect(saved.wxpusher.uid).toBe("UID_demo_0001");
  });

  it("owner 只改一个密钥 → 该项更新，其它仍是原值", async () => {
    const got = await (await getNotify(owner)).json() as Record<string, unknown>;
    const res = await postNotify(owner, { ...got, wxToken: "AT_brand-new-token-9876543210-NEW1" });
    expect(res.status).toBe(200);
    const saved = readSaved();
    expect(saved.wxpusher.appToken).toBe("AT_brand-new-token-9876543210-NEW1");
    expect(saved.telegram.token).toBe(TG_TOKEN);
    expect(saved.serverChan).toBe(SERVER_CHAN);
    expect(saved.wechatWebhook).toBe(WECOM);
  });

  it("owner 清空某项 → 该通道被移除（清空仍然生效）", async () => {
    const got = await (await getNotify(owner)).json() as Record<string, unknown>;
    const res = await postNotify(owner, { ...got, serverChan: "" });
    expect(res.status).toBe(200);
    const saved = readSaved() as Partial<typeof seed>;
    expect(saved.serverChan).toBeUndefined();
    expect(saved.wxpusher?.appToken).toBe(WX_TOKEN);
  });

  it("很短的密钥打码后不露出任何字符", async () => {
    writeFileSync(notifyFile(), JSON.stringify({ ...seed, serverChan: "k9Z7" }, null, 2), "utf8");
    const body = await (await getNotify(owner)).json() as Record<string, string>;
    expect(body.serverChan).not.toContain("k9Z7");
    expect(body.serverChan).not.toContain("9Z7");
    expect(body.serverChan.length).toBeGreaterThan(0);
  });

  it("member 保存 → 403，文件不变", async () => {
    const res = await postNotify(member, { wxToken: "AT_evil", wxUid: "UID_evil" });
    expect(res.status).toBe(403);
    expect(readSaved().wxpusher.appToken).toBe(WX_TOKEN);
  });
});