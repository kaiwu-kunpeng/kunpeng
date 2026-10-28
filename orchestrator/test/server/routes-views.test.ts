import { describe, it, expect } from "vitest";
import "../../src/server/routes/views.js";
import { listModularRoutes } from "../../src/server/routes/registry.js";
import { handlePreviewsRoute } from "../../src/server/routes/views.js";
import { parseProjectRoute, isOverviewRoute } from "../../src/server/view-state.js";

describe("视图层析出", () => {
  it("注册 /doc 与 /api/view", () => {
    const routes = listModularRoutes();
    const has = (m: string, p: string) => routes.some((r) => r.method === m && r.path === p);
    expect(has("GET", "/doc")).toBe(true);
    expect(has("GET", "/api/view")).toBe(true);
  });

  it("previews 处理器与 view-state 叶子可独立调用", async () => {
    expect(typeof handlePreviewsRoute).toBe("function");
    expect(parseProjectRoute("#/project/x/loops")).toEqual({ id: "x", tab: "loops" });
    expect(isOverviewRoute("#/overview")).toBe(true);
    expect(isOverviewRoute("#/inbox")).toBe(false);
  });
});