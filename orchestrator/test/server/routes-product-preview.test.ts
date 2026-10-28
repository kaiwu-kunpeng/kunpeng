import { describe, it, expect } from "vitest";
import "../../src/server/routes/product-preview.js";
import { listModularRoutes } from "../../src/server/routes/registry.js";
import { freeTcpPort } from "../../src/server/net-util.js";

describe("product-preview 路由析出", () => {
  it("注册全部 7 条路由", () => {
    const routes = listModularRoutes();
    const has = (m: string, p: string) => routes.some((r) => r.method === m && r.path === p);
    expect(has("POST", "/api/product/preview/start")).toBe(true);
    expect(has("POST", "/api/product/checkup")).toBe(true);
    expect(has("POST", "/api/product/preview/stop")).toBe(true);
    expect(has("POST", "/api/product/publish")).toBe(true);
    expect(has("POST", "/api/product/qa")).toBe(true);
    expect(has("POST", "/api/product/pick-task")).toBe(true);
    expect(has("GET", "/api/product/preview")).toBe(true);
  });

  it("freeTcpPort 返回可用端口", async () => {
    const port = await freeTcpPort();
    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThan(0);
  });
});