import { describe, it, expect } from "vitest";
import "../../src/server/routes/product-define.js";
import { listModularRoutes } from "../../src/server/routes/registry.js";

describe("product-define 路由析出", () => {
  it("注册全部 9 条路由", () => {
    const routes = listModularRoutes();
    const has = (m: string, p: string) => routes.some((r) => r.method === m && r.path === p);
    expect(has("GET", "/api/product/templates")).toBe(true);
    expect(has("GET", "/api/product/env")).toBe(true);
    expect(has("POST", "/api/product/env/init")).toBe(true);
    expect(has("POST", "/api/product-start")).toBe(true);
    expect(has("POST", "/api/product-answer")).toBe(true);
    expect(has("POST", "/api/product-to-spec")).toBe(true);
    expect(has("GET", "/api/product/plan")).toBe(true);
    expect(has("GET", "/api/product/state")).toBe(true);
    expect(has("GET", "/api/product/list")).toBe(true);
  });
});