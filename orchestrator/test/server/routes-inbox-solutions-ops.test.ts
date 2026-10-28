import { describe, it, expect } from "vitest";
import "../../src/server/routes/inbox.js";
import "../../src/server/routes/solutions-ops.js";
import { listModularRoutes } from "../../src/server/routes/registry.js";

describe("inbox + solutions/ops 路由析出", () => {
  it("注册全部 5 条", () => {
    const routes = listModularRoutes();
    const has = (m: string, p: string) => routes.some((r) => r.method === m && r.path === p);
    expect(has("POST", "/api/inbox/seen")).toBe(true);
    expect(has("POST", "/api/inbox/dismiss")).toBe(true);
    expect(has("GET", "/api/arch-graph")).toBe(true);
    expect(has("POST", "/api/solutions/apply")).toBe(true);
    expect(has("POST", "/api/ops/run")).toBe(true);
  });
});