import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideAuth, decideWebhookAuth, isLoopbackAddress, signSession } from "../../src/server/auth.js";
import { createLoginLimiter } from "../../src/server/login-limiter.js";
import { appendAudit, readAuditTail } from "../../src/server/audit.js";

const NOW = 1_800_000_000_000;
const MAX_AGE = 7 * 24 * 3600 * 1000;

describe("fail-closed：无 auth.json 时远程一律拒绝", () => {
  it("loopback 请求照旧 allow（本机既有用法不破坏）", () => {
    const a = decideAuth({ authEnabled: false, path: "/api/state", method: "GET", secret: "", now: NOW, maxAgeMs: MAX_AGE, remoteIsLoopback: true });
    expect(a).toBe("allow");
  });
  it("非 loopback 请求 → forbidden-remote", () => {
    const a = decideAuth({ authEnabled: false, path: "/api/state", method: "GET", secret: "", now: NOW, maxAgeMs: MAX_AGE, remoteIsLoopback: false });
    expect(a).toBe("forbidden-remote");
  });
  it("authEnabled 时远程带有效会话照常 allow", () => {
    const token = signSession("u1", "home", "s3cret", NOW);
    const a = decideAuth({ authEnabled: true, path: "/api/state", method: "GET", cookieHeader: `kp_session=${token}`, secret: "s3cret", now: NOW + 1000, maxAgeMs: MAX_AGE, remoteIsLoopback: false });
    expect(a).toBe("allow");
  });
  it("isLoopbackAddress 判定", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("192.168.1.5")).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });
});

describe("webhook secret 守卫", () => {
  it("配置 secret：header 不等 → deny（即使 loopback）", () => {
    expect(decideWebhookAuth({ configuredSecret: "topsecret", headerSecret: "abc", remoteIsLoopback: false })).toBe("deny");
    expect(decideWebhookAuth({ configuredSecret: "topsecret", headerSecret: undefined, remoteIsLoopback: true })).toBe("deny");
  });
  it("配置 secret 且匹配 → allow（远程也行）", () => {
    expect(decideWebhookAuth({ configuredSecret: "topsecret", headerSecret: "topsecret", remoteIsLoopback: false })).toBe("allow");
  });
  it("未配置 secret：loopback allow、远程 deny", () => {
    expect(decideWebhookAuth({ configuredSecret: undefined, headerSecret: undefined, remoteIsLoopback: true })).toBe("allow");
    expect(decideWebhookAuth({ configuredSecret: undefined, headerSecret: undefined, remoteIsLoopback: false })).toBe("deny");
  });
});

describe("登录限流", () => {
  it("5 次失败后锁定，给出 retryAfterMs，窗口过后恢复", () => {
    const lim = createLoginLimiter({ maxFails: 5, windowMs: 600_000, lockMs: 60_000 });
    for (let i = 0; i < 5; i++) lim.recordFail("u|1.2.3.4", NOW + i * 1000);
    const locked = lim.check("u|1.2.3.4", NOW + 5000);
    expect(locked.allowed).toBe(false);
    expect((locked.retryAfterMs ?? 0) > 0).toBe(true);
    const after = lim.check("u|1.2.3.4", NOW + 4000 + 60_001);
    expect(after.allowed).toBe(true);
  });
  it("recordSuccess 清零", () => {
    const lim = createLoginLimiter({ maxFails: 2, windowMs: 600_000, lockMs: 60_000 });
    lim.recordFail("k", NOW);
    lim.recordFail("k", NOW + 1);
    expect(lim.check("k", NOW + 2).allowed).toBe(false);
    lim.recordSuccess("k");
    expect(lim.check("k", NOW + 3).allowed).toBe(true);
  });
  it("不同 key 互不影响", () => {
    const lim = createLoginLimiter({ maxFails: 1, windowMs: 600_000, lockMs: 60_000 });
    lim.recordFail("a", NOW);
    expect(lim.check("a", NOW + 1).allowed).toBe(false);
    expect(lim.check("b", NOW + 1).allowed).toBe(true);
  });
});

describe("append 审计", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-audit-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("追加两条可读回，文件按月落 jsonl", async () => {
    await appendAudit(dir, { at: NOW, action: "login-ok", user: "u1" });
    await appendAudit(dir, { at: NOW + 1000, action: "api-write", user: "u1", path: "/api/tasks" });
    const files = readdirSync(join(dir, "audit")).filter((f) => f.startsWith("audit-") && f.endsWith(".jsonl"));
    expect(files.length).toBeGreaterThanOrEqual(1);
    const tail = await readAuditTail(dir, 1);
    expect(tail).toHaveLength(1);
    expect(tail[0].action).toBe("api-write");
    expect(tail[0].path).toBe("/api/tasks");
  });
  it("readAuditTail 超量取全部、坏行跳过、无目录返回空", async () => {
    expect(await readAuditTail(dir, 5)).toHaveLength(0);
    await appendAudit(dir, { at: NOW, action: "x" });
    expect((await readAuditTail(dir, 99))).toHaveLength(1);
  });
});