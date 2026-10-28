import { describe, expect, it } from "vitest";
import "../../src/server/http.js";
import { listModularRoutes } from "../../src/server/routes/registry.js";
import { authorizeRequest, capabilityForRoute, RESTRICTED_POLICY } from "../../src/server/authz.js";

const member = { id: "m1", username: "mem", salt: "s", hash: "h", profileId: "p", role: "member" as const, updatedAt: 1 };
const session = { accountId: "m1", profileId: "p", issuedAt: 1 };

describe("read 能力只给无副作用的接口（作者锁定）", () => {
  it.each([
    ["POST", "/api/feedback", "dispatch"],
    ["POST", "/api/inbox/dismiss", "chat"],
    ["POST", "/api/inbox/seen", "chat"],
  ])("%s %s → %s", (method, path, capability) => {
    expect(capabilityForRoute(path, method)).toBe(capability);
  });

  it("除登录/登出与鉴权前处理的 beacon 外，没有任何非 GET 路由被登记成 read", () => {
    const allowed = new Set(["/api/login", "/api/logout", "/api/beacon"]);
    const offenders = listModularRoutes()
      .filter((r) => r.method.toUpperCase() !== "GET" && capabilityForRoute(r.path, r.method) === "read" && !allowed.has(r.path))
      .map((r) => `${r.method} ${r.path}`);
    expect(offenders).toEqual([]);
  });

  it("member 仍能写反馈、忽略与标记已读收件箱", () => {
    for (const [method, path] of [["POST", "/api/feedback"], ["POST", "/api/inbox/dismiss"], ["POST", "/api/inbox/seen"]] as const) {
      expect(authorizeRequest(session, [member], path, RESTRICTED_POLICY, method).ok, `${method} ${path}`).toBe(true);
    }
  });

  it("只有 read 能力的角色写不了这三条（read 回到纯只读语义）", () => {
    const readOnly = { roles: { owner: RESTRICTED_POLICY.roles.owner, member: ["read"] as const } };
    for (const [method, path] of [["POST", "/api/feedback"], ["POST", "/api/inbox/dismiss"], ["POST", "/api/inbox/seen"]] as const) {
      expect(authorizeRequest(session, [member], path, readOnly, method)).toEqual({ ok: false, status: 403 });
    }
    expect(authorizeRequest(session, [member], "/api/state", readOnly, "GET").ok).toBe(true);
  });
});