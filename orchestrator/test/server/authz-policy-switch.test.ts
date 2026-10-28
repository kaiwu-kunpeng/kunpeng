import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { authorizeRequest, resolveAuthzPolicy, RESTRICTED_POLICY } from "../../src/server/authz.js";
import type { AccountRecord, ParsedSession } from "../../src/server/auth.js";

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const root = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

const accounts = [
  { id: "a-owner", username: "admin", profileId: "home", role: "owner" },
  { id: "a-member", username: "bob", profileId: "home", role: "member" },
] as unknown as AccountRecord[];
const sess = (accountId: string): ParsedSession => ({ accountId, profileId: "home" } as unknown as ParsedSession);

describe("KUNPENG_AUTHZ_POLICY 开关(作者锁定)", () => {
  it("未设置 / 空 / restricted → RESTRICTED_POLICY；open / legacy → undefined", () => {
    expect(resolveAuthzPolicy({})).toBe(RESTRICTED_POLICY);
    expect(resolveAuthzPolicy({ KUNPENG_AUTHZ_POLICY: "" })).toBe(RESTRICTED_POLICY);
    expect(resolveAuthzPolicy({ KUNPENG_AUTHZ_POLICY: "   " })).toBe(RESTRICTED_POLICY);
    expect(resolveAuthzPolicy({ KUNPENG_AUTHZ_POLICY: "legacy" })).toBeUndefined();
    expect(resolveAuthzPolicy({ KUNPENG_AUTHZ_POLICY: "open" })).toBeUndefined();
  });

  it("restricted(忽略大小写与首尾空白) → 就是 RESTRICTED_POLICY 这个对象", () => {
    expect(resolveAuthzPolicy({ KUNPENG_AUTHZ_POLICY: "restricted" })).toBe(RESTRICTED_POLICY);
    expect(resolveAuthzPolicy({ KUNPENG_AUTHZ_POLICY: " Restricted " })).toBe(RESTRICTED_POLICY);
  });

  it("默认参数读 process.env", () => {
    const prev = process.env.KUNPENG_AUTHZ_POLICY;
    try {
      delete process.env.KUNPENG_AUTHZ_POLICY;
      expect(resolveAuthzPolicy()).toBe(RESTRICTED_POLICY);
      process.env.KUNPENG_AUTHZ_POLICY = "open";
      expect(resolveAuthzPolicy()).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.KUNPENG_AUTHZ_POLICY;
      else process.env.KUNPENG_AUTHZ_POLICY = prev;
    }
  });

  it("restricted 下 member:终端/本地目录/合并 403,浏览/对话/派流放行;owner 全放行", () => {
    const p = resolveAuthzPolicy({ KUNPENG_AUTHZ_POLICY: "restricted" });
    expect(authorizeRequest(sess("a-member"), accounts, "/api/pty/open", p)).toEqual({ ok: false, status: 403 });
    expect(authorizeRequest(sess("a-member"), accounts, "/api/localfs/enqueue", p)).toEqual({ ok: false, status: 403 });
    expect(authorizeRequest(sess("a-member"), accounts, "/api/merge", p)).toEqual({ ok: false, status: 403 });
    expect(authorizeRequest(sess("a-member"), accounts, "/api/view", p).ok).toBe(true);
    expect(authorizeRequest(sess("a-member"), accounts, "/api/chat/send", p).ok).toBe(true);
    expect(authorizeRequest(sess("a-member"), accounts, "/api/run", p).ok).toBe(true);
    expect(authorizeRequest(sess("a-owner"), accounts, "/api/pty/open", p).ok).toBe(true);
    expect(authorizeRequest(sess("a-owner"), accounts, "/api/accounts", p).ok).toBe(true);
  });

  it("open 下 member 老行为不变(终端仍可用,账号管理仍 403)", () => {
    const p = resolveAuthzPolicy({ KUNPENG_AUTHZ_POLICY: "open" });
    expect(authorizeRequest(sess("a-member"), accounts, "/api/pty/open", p).ok).toBe(true);
    expect(authorizeRequest(sess("a-member"), accounts, "/api/accounts", p)).toEqual({ ok: false, status: 403 });
  });

  it("两个鉴权调用点都接上了开关(精确字符串)", () => {
    expect(src("src/server/profile-middleware.ts")).toContain(
      "authorizeRequest(session, cfg.accounts, path, resolveAuthzPolicy(), req.method)",
    );
    expect(src("src/server/pty-endpoint.ts")).toContain(
      "authorizeRequest(session, authCfg.accounts, path, resolveAuthzPolicy(), req.method)",
    );
  });

  it("环境变量手册登记了 KUNPENG_AUTHZ_POLICY,并写明默认 member 不受限", () => {
    const doc = root("docs/runbooks/env-vars.md");
    expect(doc).toContain("`KUNPENG_AUTHZ_POLICY`");
    expect(doc).toContain("`restricted`");
    expect(doc).toContain("member 与 owner 能力相同");
    expect(doc).toContain("`KUNPENG_AUTH_PASSWORD`");
    expect(doc.indexOf("`KUNPENG_AUTH_PASSWORD`")).toBeLessThan(doc.indexOf("`KUNPENG_AUTHZ_POLICY`"));
    expect(doc.indexOf("`KUNPENG_AUTHZ_POLICY`")).toBeLessThan(doc.indexOf("`KUNPENG_AUTO_MERGE`"));
  });
});
