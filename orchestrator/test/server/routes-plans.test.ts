import { describe, it, expect } from "vitest";
import "../../src/server/routes/plans.js";
import { listModularRoutes } from "../../src/server/routes/registry.js";

describe("plans 路由析出", () => {
  it("注册全部 9 条路由", () => {
    const routes = listModularRoutes();
    const has = (m: string, p: string) => routes.some((r) => r.method === m && r.path === p);
    expect(has("POST", "/api/edit-proposal")).toBe(true);
    expect(has("GET", "/api/proposal-body")).toBe(true);
    expect(has("GET", "/api/eval-report")).toBe(true);
    expect(has("GET", "/api/flow-log")).toBe(true);
    expect(has("GET", "/api/evidence")).toBe(true);
    expect(has("GET", "/api/plans")).toBe(true);
    expect(has("GET", "/api/plan-file")).toBe(true);
    expect(has("POST", "/api/save-plan")).toBe(true);
    expect(has("POST", "/api/gc")).toBe(true);
  });
});