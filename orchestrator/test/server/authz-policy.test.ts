// 验收锚:权限策略要有处可表达、可判定;且不传策略时行为逐字节不变。
import { describe, it, expect } from "vitest";
import {
  authorizeRequest,
  capabilityForPath,
  RESTRICTED_POLICY,
  type AuthzPolicy,
} from "../../src/server/authz.js";
import type { AccountRecord, ParsedSession } from "../../src/server/auth.js";

const accounts = [
  { id: "a-owner", username: "admin", profileId: "home", role: "owner" },
  { id: "a-member", username: "afeng", profileId: "home", role: "member" },
] as unknown as AccountRecord[];

const sess = (accountId: string): ParsedSession =>
  ({ accountId, profileId: "home" } as unknown as ParsedSession);

describe("capabilityForPath", () => {
  it("按表判定各路径的能力", () => {
    expect(capabilityForPath("/api/accounts")).toBe("accounts");
    expect(capabilityForPath("/api/accounts/add")).toBe("accounts");
    expect(capabilityForPath("/api/pty/open")).toBe("terminal");
    expect(capabilityForPath("/kpworker/x")).toBe("terminal");
    expect(capabilityForPath("/api/localfs/enqueue")).toBe("localfs");
    expect(capabilityForPath("/api/chat/send")).toBe("chat");
    expect(capabilityForPath("/api/conversations")).toBe("chat");
    expect(capabilityForPath("/api/run")).toBe("dispatch");
    expect(capabilityForPath("/api/merge")).toBe("merge");
    expect(capabilityForPath("/api/reject")).toBe("merge");
  });

  it("页面路径是 read，未登记的 API 路径是 undefined", () => {
    expect(capabilityForPath("/api/view")).toBe("read");
    expect(capabilityForPath("/api/state")).toBe("read");
    expect(capabilityForPath("/")).toBe("read");
    expect(capabilityForPath("/api/definitely-not-a-route")).toBeUndefined();
  });
});

describe("不传 policy:行为与改动前一致", () => {
  it("owner 与 member 都能过普通路径", () => {
    expect(authorizeRequest(sess("a-owner"), accounts, "/api/view").ok).toBe(true);
    expect(authorizeRequest(sess("a-member"), accounts, "/api/view").ok).toBe(true);
  });

  it("member 碰账号管理仍是 403,owner 仍放行", () => {
    expect(authorizeRequest(sess("a-member"), accounts, "/api/accounts")).toEqual({ ok: false, status: 403 });
    expect(authorizeRequest(sess("a-owner"), accounts, "/api/accounts").ok).toBe(true);
  });

  it("member 老行为下终端/本地文件仍可用(证明本流没偷偷改默认)", () => {
    expect(authorizeRequest(sess("a-member"), accounts, "/api/pty/open").ok).toBe(true);
    expect(authorizeRequest(sess("a-member"), accounts, "/api/localfs/enqueue").ok).toBe(true);
  });

  it("未知账号 401、profile 不符 401", () => {
    expect(authorizeRequest(sess("ghost"), accounts, "/api/view")).toEqual({ ok: false, status: 401 });
    const wrong = { accountId: "a-owner", profileId: "other" } as unknown as ParsedSession;
    expect(authorizeRequest(wrong, accounts, "/api/view")).toEqual({ ok: false, status: 401 });
  });
});

describe("传入 policy:按能力判定", () => {
  it("能力不足 → 403", () => {
    const r = authorizeRequest(sess("a-member"), accounts, "/api/pty/open", RESTRICTED_POLICY);
    expect(r).toEqual({ ok: false, status: 403 });
  });

  it("能力足够 → 放行,且返回字段不变", () => {
    const r = authorizeRequest(sess("a-member"), accounts, "/api/view", RESTRICTED_POLICY);
    expect(r).toMatchObject({ ok: true, accountId: "a-member", username: "afeng", role: "member" });
  });

  it("owner 在受限策略下仍拥有全部能力", () => {
    for (const p of ["/api/pty/open", "/api/localfs/enqueue", "/api/merge", "/api/accounts"]) {
      expect(authorizeRequest(sess("a-owner"), accounts, p, RESTRICTED_POLICY).ok).toBe(true);
    }
  });

  it("401 判定优先于能力判定", () => {
    expect(authorizeRequest(sess("ghost"), accounts, "/api/pty/open", RESTRICTED_POLICY))
      .toEqual({ ok: false, status: 401 });
  });

  it("策略里未列出的角色按老行为,不会被意外锁死", () => {
    const partial: AuthzPolicy = { roles: { owner: ["read"] } };
    expect(authorizeRequest(sess("a-member"), accounts, "/api/pty/open", partial).ok).toBe(true);
    expect(authorizeRequest(sess("a-member"), accounts, "/api/accounts")).toEqual({ ok: false, status: 403 });
  });
});

describe("RESTRICTED_POLICY 预设", () => {
  it("member 不含终端/本地文件/合并/账号管理", () => {
    const m = RESTRICTED_POLICY.roles.member ?? [];
    for (const cap of ["terminal", "localfs", "merge", "accounts"]) {
      expect(m).not.toContain(cap);
    }
  });

  it("member 保留只读与派流", () => {
    const m = RESTRICTED_POLICY.roles.member ?? [];
    expect(m).toContain("read");
    expect(m).toContain("dispatch");
  });

  it("owner 拥有全部能力", () => {
    const o = RESTRICTED_POLICY.roles.owner ?? [];
    for (const cap of ["read", "chat", "dispatch", "merge", "terminal", "localfs", "accounts"]) {
      expect(o).toContain(cap);
    }
  });
});