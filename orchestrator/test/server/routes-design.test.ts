import { describe, it, expect } from "vitest";
import "../../src/server/routes/design.js";
import { listModularRoutes } from "../../src/server/routes/registry.js";

describe("design 路由析出", () => {
  it("注册全部 6 条路由", () => {
    const routes = listModularRoutes();
    const has = (m: string, p: string) => routes.some((r) => r.method === m && r.path === p);
    expect(has("POST", "/api/design-codegen")).toBe(true);
    expect(has("POST", "/api/design-advise")).toBe(true);
    expect(has("POST", "/api/design-loop")).toBe(true);
    expect(has("POST", "/api/design-preview")).toBe(true);
    expect(has("GET", "/api/design-presets")).toBe(true);
    expect(has("POST", "/api/design-generate")).toBe(true);
  });
});