import { describe, it, expect } from "vitest";
import "../../src/server/routes/overview.js";
import { listModularRoutes } from "../../src/server/routes/registry.js";
import { dashboardProjects, singleSnapshot } from "../../src/server/snapshots.js";

describe("overview 路由终局析出", () => {
  it("注册 projects/pills/state", () => {
    const routes = listModularRoutes();
    const has = (m: string, p: string) => routes.some((r) => r.method === m && r.path === p);
    expect(has("GET", "/api/projects")).toBe(true);
    expect(has("GET", "/api/pills")).toBe(true);
    expect(has("POST", "/api/pills")).toBe(true);
    expect(has("GET", "/api/state")).toBe(true);
    expect(has("POST", "/api/state")).toBe(true);
  });

  it("snapshots 叶子可独立调用", async () => {
    expect(typeof singleSnapshot).toBe("function");
    const projects = await dashboardProjects({ repoRoot: "/nonexistent-kp-x" });
    expect(Array.isArray(projects)).toBe(true);
  });
});