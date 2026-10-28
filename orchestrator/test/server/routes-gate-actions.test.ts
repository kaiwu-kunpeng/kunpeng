import { describe, it, expect } from "vitest";
import "../../src/server/routes/gate-actions.js";
import { listModularRoutes } from "../../src/server/routes/registry.js";

describe("gate-actions 路由析出", () => {
  it("注册全部 8 条路由", () => {
    const routes = listModularRoutes();
    const has = (p: string) => routes.some((r) => r.path === p);
    for (const p of [
      "/api/merge",
      "/api/autopilot",
      "/api/approve-connector",
      "/api/approve",
      "/api/confirm-release",
      "/api/reject",
      "/api/ops-gates",
      "/api/ops-gate-decide",
    ]) expect(has(p), p).toBe(true);
  });
});