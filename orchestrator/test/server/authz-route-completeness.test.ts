import { describe, expect, it } from "vitest";
import "../../src/server/http.js";
import { listModularRoutes } from "../../src/server/routes/registry.js";
import { capabilityForRoute, ROUTE_CAPABILITY_TABLE } from "../../src/server/authz.js";

const INLINE = [
  ["GET", "/api/login"], ["POST", "/api/login"], ["POST", "/api/logout"], ["POST", "/api/beacon"], ["GET", "/api/pty"], ["GET", "/kpworker"],
  ["POST", "/api/worker/connect"], ["POST", "/api/worker/exec"], ["POST", "/api/worker/fs"], ["POST", "/api/localfs"], ["POST", "/api/localfs/enqueue"],
  ["POST", "/api/dispatch"], ["POST", "/api/drain"], ["GET", "/api/push/pending"], ["POST", "/api/chat"], ["GET", "/api/conversations"],
  ["GET", "/api/conversations/abc123"], ["POST", "/api/gate"], ["POST", "/api/accounts/add"], ["GET", "/api/pty/open"], ["GET", "/kpworker/x"],
  ["POST", "/api/workspace/project-a/chat"],
] as const;

describe("能力表完整性（作者锁定）：新增路由不登记就红", () => {
  it("注册表里每一条 方法+路径 都有显式能力，零兜底", () => {
    const routes = listModularRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(131);
    const missing = routes.filter((r) => capabilityForRoute(r.path, r.method) === undefined).map((r) => `${r.method} ${r.path}`);
    expect(missing).toEqual([]);
    expect(Object.keys(ROUTE_CAPABILITY_TABLE).length).toBeGreaterThanOrEqual(100);
  });

  it("注册表之外的内联端点与动态家族也全部有能力", () => {
    const missing = INLINE.filter(([m, p]) => capabilityForRoute(p, m) === undefined).map(([m, p]) => `${m} ${p}`);
    expect(missing).toEqual([]);
  });

  it("未登记的 API 路径是 undefined；页面与静态资源是 read；查询串被忽略", () => {
    expect(capabilityForRoute("/api/definitely-not-a-route")).toBeUndefined();
    expect(capabilityForRoute("/api/definitely-not-a-route", "POST")).toBeUndefined();
    expect(capabilityForRoute("/")).toBe("read");
    expect(capabilityForRoute("/help")).toBe("read");
    expect(capabilityForRoute("/assets/app.js")).toBe("read");
    expect(capabilityForRoute("/api/flow-log?projectId=x&flowId=y", "GET")).toBe("read");
  });

  it.each([
    ["POST", "/api/merge", "merge"], ["POST", "/api/reject", "merge"], ["POST", "/api/ops-gate-decide", "merge"], ["POST", "/api/autopilot", "merge"], ["POST", "/api/gates/discard", "merge"],
    ["POST", "/api/run", "dispatch"], ["POST", "/api/plan", "dispatch"], ["POST", "/api/rerun", "dispatch"], ["POST", "/api/product-start", "dispatch"],
    ["POST", "/api/worker/exec", "terminal"], ["GET", "/api/pty/open", "terminal"], ["POST", "/api/worker/token", "terminal"],
    ["POST", "/api/localfs/enqueue", "localfs"],
    ["POST", "/api/accounts", "accounts"], ["DELETE", "/api/accounts", "accounts"], ["POST", "/api/auth/change-password", "accounts"],
    ["POST", "/api/register-project", "admin"], ["POST", "/api/settings/backends", "admin"], ["POST", "/api/product/publish", "admin"], ["POST", "/api/product/purge", "admin"], ["POST", "/api/drain", "admin"],
    ["POST", "/api/chat", "chat"], ["POST", "/api/knowledge-capture", "chat"], ["POST", "/api/workspace/project-a/chat", "chat"],
    ["GET", "/api/projects", "read"], ["GET", "/api/state", "read"], ["GET", "/api/view", "read"], ["GET", "/api/version", "read"], ["GET", "/api/control-plane-audit", "read"],
  ])("%s %s → %s", (method, path, capability) => {
    expect(capabilityForRoute(path, method)).toBe(capability);
  });

  it("没有一条 POST 路由被登记成 read，除了收件箱已读/忽略与反馈这三条显式白名单", () => {
    const allowedReadPosts = new Set(["/api/inbox/seen", "/api/inbox/dismiss", "/api/feedback", "/api/login", "/api/logout", "/api/beacon"]);
    const offenders = listModularRoutes()
      .filter((r) => r.method.toUpperCase() !== "GET" && capabilityForRoute(r.path, r.method) === "read" && !allowedReadPosts.has(r.path))
      .map((r) => `${r.method} ${r.path}`);
    expect(offenders).toEqual([]);
  });
});