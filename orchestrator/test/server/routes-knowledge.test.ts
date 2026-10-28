import { describe, it, expect } from "vitest";
import "../../src/server/routes/knowledge.js";
import { listModularRoutes } from "../../src/server/routes/registry.js";

describe("knowledge 路由析出", () => {
  it("注册全部 12 条路由", () => {
    const routes = listModularRoutes();
    const has = (m: string, p: string) => routes.some((r) => r.method === m && r.path === p);
    expect(has("GET", "/api/knowledge-search")).toBe(true);
    expect(has("GET", "/api/kb")).toBe(true);
    expect(has("GET", "/api/knowledge-resurface")).toBe(true);
    expect(has("GET", "/api/knowledge-tagcloud")).toBe(true);
    expect(has("POST", "/api/knowledge-synthesize")).toBe(true);
    expect(has("POST", "/api/knowledge-ask")).toBe(true);
    expect(has("POST", "/api/knowledge-capture")).toBe(true);
    expect(has("POST", "/api/knowledge-promote")).toBe(true);
    expect(has("POST", "/api/knowledge-edit")).toBe(true);
    expect(has("POST", "/api/knowledge-delete")).toBe(true);
    expect(has("POST", "/api/knowledge-distill-card")).toBe(true);
    expect(has("POST", "/api/distill-skill")).toBe(true);
  });
});