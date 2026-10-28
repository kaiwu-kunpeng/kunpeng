import { describe, it, expect } from "vitest";
import { registerModularRoute, dispatchModularRoute, type RouteContext } from "../../src/server/routes/registry.js";

describe("RouteContext repoRoot 可选(多项目模式不短路 resolveRepo)", () => {
  it("dispatch 无 repoRoot 的 context,handler 收到 undefined 而非 cwd", async () => {
    let seen: string | undefined = "sentinel";
    registerModularRoute({
      method: "GET",
      path: "/api/__test/ctx-repo",
      handle: async (_req, res, _url, context) => { seen = context.repoRoot; (res as { end: (s?: string) => void }).end(); },
    });
    const context: RouteContext = { stateDir: "/tmp/x" };
    const res = { setHeader() {}, end() {} } as unknown as import("node:http").ServerResponse;
    const handled = await dispatchModularRoute("GET", "/api/__test/ctx-repo", {} as import("node:http").IncomingMessage, res, context);
    expect(handled).toBe(true);
    expect(seen).toBeUndefined();
  });
});