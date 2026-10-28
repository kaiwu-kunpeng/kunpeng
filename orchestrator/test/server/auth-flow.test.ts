import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { handleAuthAction } from "../../src/server/auth-flow.js";

const httpTs = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "server", "http.ts"),
  "utf8",
);

describe("鉴权动作块析出", () => {
  it("http.ts 不再内联六个 action 分支,enterWith 留守", () => {
    expect(httpTs).not.toContain('action === "login-page"');
    expect(httpTs).not.toContain('action === "do-login"');
    expect(httpTs).not.toContain('action === "do-logout"');
    expect(httpTs).not.toContain('action === "unauthorized-api"');
    expect(httpTs).toContain("handleAuthAction");
    expect(httpTs).toContain("enterWith");
    expect(httpTs).toContain("buildAuthGate");
  });

  it("allow 动作落空返回 false,不写响应", async () => {
    let ended = false;
    const res = { end: () => { ended = true; }, setHeader: () => {}, statusCode: 200 };
    const handled = await handleAuthAction(
      "allow" as never,
      { headers: {} } as never,
      res as never,
      { stateDir: "/nonexistent-kp-auth-x", authCfg: null as never },
    );
    expect(handled).toBe(false);
    expect(ended).toBe(false);
  });

  it("unauthorized-api 返回 401 JSON", async () => {
    let body = "";
    const res = {
      statusCode: 200,
      setHeader: () => {},
      end: (chunk?: string) => { body = chunk ?? ""; },
    };
    const handled = await handleAuthAction(
      "unauthorized-api" as never,
      { headers: {} } as never,
      res as never,
      { stateDir: "/nonexistent-kp-auth-x", authCfg: null as never },
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(401);
    expect(body).toContain("未登录");
  });
});