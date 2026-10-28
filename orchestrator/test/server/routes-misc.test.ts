import { describe, it, expect } from "vitest";
import "../../src/server/routes/misc.js";
import { listModularRoutes } from "../../src/server/routes/registry.js";

describe("misc 路由析出", () => {
  it("注册全部 14 条路径", () => {
    const routes = listModularRoutes();
    const has = (p: string) => routes.some((r) => r.path === p);
    for (const p of [
      "/api/accounts",
      "/api/perf-health",
      "/api/today",
      "/api/tasks/transition",
      "/api/tasks",
      "/api/escape-rate",
      "/api/feedback",
      "/api/register-project",
      "/api/auth/change-password",
      "/api/loop-weakpoints",
      "/api/loop-lever-to-task",
      "/api/file",
      "/api/files",
      "/api/select-design",
    ]) expect(has(p), p).toBe(true);
  });
});