import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { authorizeRequest, explainAuthzDenial, resolveAuthzPolicy, RESTRICTED_POLICY } from "../../src/server/authz.js";
import type { AccountRecord, ParsedSession } from "../../src/server/auth.js";

const accounts = [
  { id: "a-owner", username: "admin", profileId: "home", role: "owner" },
  { id: "a-member", username: "bob", profileId: "home", role: "member" },
] as unknown as AccountRecord[];
const sess = (accountId: string, profileId = "home"): ParsedSession => ({ accountId, profileId } as unknown as ParsedSession);

describe("默认 restricted + 未登记即拒 + 拒绝说明层（作者锁定）", () => {
  it("resolveAuthzPolicy：未设/空/restricted → 受限；open/legacy/off/0 → 老行为", () => {
    for (const env of [{}, { KUNPENG_AUTHZ_POLICY: "" }, { KUNPENG_AUTHZ_POLICY: "restricted" }, { KUNPENG_AUTHZ_POLICY: " Restricted " }, { KUNPENG_AUTHZ_POLICY: "whatever" }]) {
      expect(resolveAuthzPolicy(env)).toBe(RESTRICTED_POLICY);
    }
    for (const value of ["open", "legacy", "off", "0", " OPEN "]) expect(resolveAuthzPolicy({ KUNPENG_AUTHZ_POLICY: value })).toBeUndefined();
  });

  it("默认策略下 member 碰合并/终端/管理 403，owner 放行；owner 也有 admin", () => {
    const p = resolveAuthzPolicy({});
    for (const [m, path] of [["POST", "/api/merge"], ["GET", "/api/pty/open"], ["POST", "/api/register-project"], ["POST", "/api/worker/exec"]] as const) {
      expect(authorizeRequest(sess("a-member"), accounts, path, p, m)).toEqual({ ok: false, status: 403 });
      expect(authorizeRequest(sess("a-owner"), accounts, path, p, m).ok).toBe(true);
    }
    expect(RESTRICTED_POLICY.roles.owner).toContain("admin");
    expect(RESTRICTED_POLICY.roles.member).toEqual(["read", "chat", "dispatch"]);
  });

  it("受限策略下未登记的 API 路径对 owner 也是 403（fail-closed）；open 下照旧放行", () => {
    expect(authorizeRequest(sess("a-owner"), accounts, "/api/definitely-not-a-route", RESTRICTED_POLICY, "POST")).toEqual({ ok: false, status: 403 });
    expect(authorizeRequest(sess("a-owner"), accounts, "/api/definitely-not-a-route", undefined, "POST").ok).toBe(true);
  });

  it("explainAuthzDenial 说清哪一层拒的", () => {
    const p = RESTRICTED_POLICY;
    expect(explainAuthzDenial(sess("ghost"), accounts, "/api/view", p, "GET")).toMatchObject({ layer: "account" });
    expect(explainAuthzDenial(sess("a-owner", "other"), accounts, "/api/view", p, "GET")).toMatchObject({ layer: "profile" });
    const cap = explainAuthzDenial(sess("a-member"), accounts, "/api/pty/open", p, "GET");
    expect(cap).toMatchObject({ layer: "capability" });
    expect(cap!.detail).toContain("terminal");
    expect(cap!.detail).toContain("/api/pty/open");
    const unmapped = explainAuthzDenial(sess("a-owner"), accounts, "/api/definitely-not-a-route", p, "POST");
    expect(unmapped).toMatchObject({ layer: "unmapped-route" });
    expect(unmapped!.detail).toContain("/api/definitely-not-a-route");
    expect(explainAuthzDenial(sess("a-member"), accounts, "/api/accounts", undefined, "GET")).toMatchObject({ layer: "legacy-accounts" });
    expect(explainAuthzDenial(sess("a-owner"), accounts, "/api/merge", p, "POST")).toBeNull();
  });

  it("两个鉴权调用点都传 req.method 且中间件响应带 layer", () => {
    const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../../src/server/${rel}`, import.meta.url)), "utf8");
    expect(src("profile-middleware.ts")).toContain("authorizeRequest(session, cfg.accounts, path, resolveAuthzPolicy(), req.method)");
    expect(src("profile-middleware.ts")).toContain("explainAuthzDenial(");
    expect(src("profile-middleware.ts")).toContain("layer");
    expect(src("pty-endpoint.ts")).toContain("authorizeRequest(session, authCfg.accounts, path, resolveAuthzPolicy(), req.method)");
  });
});