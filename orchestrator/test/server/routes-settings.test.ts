import { describe, it, expect } from "vitest";
import "../../src/server/routes/settings.js";
import { listModularRoutes } from "../../src/server/routes/registry.js";

describe("settings 路由析出", () => {
  it("注册 notify(GET+POST) 与 backends(POST)", () => {
    const routes = listModularRoutes();
    const has = (m: string, p: string) => routes.some((r) => r.method === m && r.path === p);
    expect(has("GET", "/api/settings/notify")).toBe(true);
    expect(has("POST", "/api/settings/notify")).toBe(true);
    expect(has("POST", "/api/settings/backends")).toBe(true);
  });
});