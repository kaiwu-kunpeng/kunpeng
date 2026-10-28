import { describe, it, expect } from "vitest";
import "../../src/server/routes/product-build.js";
import { listModularRoutes, dispatchModularRoute, registerModularRoute, type RouteContext } from "../../src/server/routes/registry.js";

describe("product-build 路由析出", () => {
  it("注册全部 5 条 POST 路由", () => {
    const routes = listModularRoutes();
    const has = (p: string) => routes.some((r) => r.method === "POST" && r.path === p);
    for (const p of [
      "/api/product/spec/save",
      "/api/product/accept",
      "/api/product/buildspec/save",
      "/api/product/design/run",
      "/api/product/validate",
    ]) expect(has(p), p).toBe(true);
  });

  it("RouteContext 透传启动器字段", async () => {
    let seen: { execPath?: string; cliJs?: string } = {};
    registerModularRoute({
      method: "GET",
      path: "/api/__test/launcher-ctx",
      handle: async (_req, res, _url, context) => { seen = { execPath: context.execPath, cliJs: context.cliJs }; (res as { end: (s?: string) => void }).end(); },
    });
    const context: RouteContext = { stateDir: "/tmp/x", execPath: "/usr/bin/node", cliJs: "/x/cli.js" };
    const res = { setHeader() {}, end() {} } as unknown as import("node:http").ServerResponse;
    await dispatchModularRoute("GET", "/api/__test/launcher-ctx", {} as import("node:http").IncomingMessage, res, context);
    expect(seen.execPath).toBe("/usr/bin/node");
    expect(seen.cliJs).toBe("/x/cli.js");
  });
});