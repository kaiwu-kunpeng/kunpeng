import { describe, it, expect } from "vitest";
import "../../src/server/routes/product-workspace.js";
import { listModularRoutes } from "../../src/server/routes/registry.js";

describe("product-workspace 路由析出", () => {
  it("注册全部 9 条 POST 路由", () => {
    const routes = listModularRoutes();
    const has = (p: string) => routes.some((r) => r.method === "POST" && r.path === p);
    for (const p of [
      "/api/product/new",
      "/api/product/activate",
      "/api/product/snapshot",
      "/api/product/rollback",
      "/api/product/ws-restore",
      "/api/product/copy-ref",
      "/api/product/delete",
      "/api/product/purge",
      "/api/product/restore",
    ]) expect(has(p), p).toBe(true);
  });
});