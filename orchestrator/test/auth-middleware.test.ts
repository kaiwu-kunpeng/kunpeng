import { describe, it, expect } from "vitest";
import { decideAuth, sessionCookie, renderLoginPage, signSession, SESSION_MAX_AGE_MS } from "../src/server/auth.js";

const SECRET = "test-secret";
const base = { secret: SECRET, now: 1000, maxAgeMs: SESSION_MAX_AGE_MS };

describe("decideAuth", () => {
  it("未启用鉴权 -> 一律 allow", () => {
    expect(decideAuth({ ...base, authEnabled: false, path: "/api/run", method: "POST" })).toBe("allow");
  });

  it("登录相关路由放行", () => {
    expect(decideAuth({ ...base, authEnabled: true, path: "/api/login", method: "POST" })).toBe("do-login");
    expect(decideAuth({ ...base, authEnabled: true, path: "/api/logout", method: "GET" })).toBe("do-logout");
    expect(decideAuth({ ...base, authEnabled: true, path: "/login", method: "GET" })).toBe("login-page");
  });

  it("启用鉴权 + 无 cookie -> 页面跳登录、API 返 401", () => {
    expect(decideAuth({ ...base, authEnabled: true, path: "/", method: "GET" })).toBe("redirect-login");
    expect(decideAuth({ ...base, authEnabled: true, path: "/api/run", method: "POST" })).toBe("unauthorized-api");
  });

  it("有效会话 cookie -> allow", () => {
    const tok = signSession("admin", "home", SECRET, 1000);
    expect(decideAuth({
      ...base,
      now: 1500,
      authEnabled: true,
      path: "/api/run",
      method: "POST",
      cookieHeader: `kp_session=${tok}`,
    })).toBe("allow");
  });

  it("无效/篡改会话 -> 仍拦", () => {
    expect(decideAuth({
      ...base,
      authEnabled: true,
      path: "/",
      method: "GET",
      cookieHeader: "kp_session=garbage",
    })).toBe("redirect-login");
  });

  it("过期会话 -> 拦", () => {
    const tok = signSession("admin", "home", SECRET, 1000);
    expect(decideAuth({
      ...base,
      now: 1000 + SESSION_MAX_AGE_MS + 1,
      authEnabled: true,
      path: "/api/run",
      method: "POST",
      cookieHeader: `kp_session=${tok}`,
    })).toBe("unauthorized-api");
  });
});

describe("sessionCookie", () => {
  it("正常 cookie 含 HttpOnly + Max-Age", () => {
    const c = sessionCookie("tok");
    expect(c).toContain("kp_session=tok");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Max-Age=");
  });

  it("expire cookie 清除(Max-Age=0、空值)", () => {
    const c = sessionCookie("", true);
    expect(c).toContain("Max-Age=0");
    expect(c).toContain("kp_session=;");
  });
});

describe("renderLoginPage", () => {
  it("含登录表单 + 错误位 + 提交到 /api/login", () => {
    const h = renderLoginPage("出错了");
    expect(h).toContain("登录");
    expect(h).toContain("/api/login");
    expect(h).toContain("出错了");
  });
});
