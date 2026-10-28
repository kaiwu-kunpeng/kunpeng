import { describe, it, expect } from "vitest";
import "../../src/server/routes/run-control.js";
import { listModularRoutes } from "../../src/server/routes/registry.js";

describe("run-control 路由析出", () => {
  it("注册全部 8 条 POST 路由", () => {
    const routes = listModularRoutes();
    const has = (p: string) => routes.some((r) => r.method === "POST" && r.path === p);
    for (const p of [
      "/api/abandon-flow",
      "/api/pause",
      "/api/resume",
      "/api/run",
      "/api/loop-run",
      "/api/plan",
      "/api/stop",
      "/api/rerun",
    ]) expect(has(p), p).toBe(true);
  });
});