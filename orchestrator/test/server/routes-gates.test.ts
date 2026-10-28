import { describe, it, expect } from "vitest";
import "../../src/server/routes/gates.js";
import { listModularRoutes } from "../../src/server/routes/registry.js";

describe("gates 路由析出到模块化注册", () => {
  it("注册了 diagnosis(GET) 与 discard(POST)", () => {
    const routes = listModularRoutes();
    const has = (method: string, path: string) => routes.some((r) => r.method === method && r.path === path);
    expect(has("GET", "/api/gates/diagnosis")).toBe(true);
    expect(has("POST", "/api/gates/discard")).toBe(true);
  });
});