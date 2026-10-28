import { describe, it, expect } from "vitest";
import "../../src/server/routes/gates.js";
import { listModularRoutes } from "../../src/server/routes/registry.js";

describe("gate-diff 并入模块化 gates 路由", () => {
  it("注册了 /api/gate-diff 与 /api/gates/diff（GET）", () => {
    const routes = listModularRoutes();
    const has = (p: string) => routes.some((r) => r.method === "GET" && r.path === p);
    expect(has("/api/gate-diff")).toBe(true);
    expect(has("/api/gates/diff")).toBe(true);
  });
});