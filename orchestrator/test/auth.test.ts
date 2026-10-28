import { describe, expect, it } from "vitest";
import {
  buildAuthConfig,
  hashPassword,
  parseCookies,
  signSession,
  verifyPassword,
  verifySession,
} from "../src/server/auth.js";

describe("password hash", () => {
  it("同盐同密码哈希稳定、可校验", () => {
    const salt = "abcd1234";
    const h = hashPassword("s3cret", salt);
    expect(hashPassword("s3cret", salt)).toBe(h);
    expect(verifyPassword("s3cret", { salt, hash: h })).toBe(true);
  });

  it("错密码不通过", () => {
    const cfg = buildAuthConfig("admin", "right", { salt: "aa", secret: "x", now: 1 });
    expect(verifyPassword("wrong", cfg.accounts[0])).toBe(false);
    expect(verifyPassword("right", cfg.accounts[0])).toBe(true);
  });

  it("buildAuthConfig 不含明文密码", () => {
    const cfg = buildAuthConfig("admin", "p@ss", { salt: "aa", secret: "x", now: 1 });
    expect(JSON.stringify(cfg)).not.toContain("p@ss");
    expect(cfg.accounts[0].hash.length).toBeGreaterThan(0);
  });
});

describe("session", () => {
  it("签发→校验通过返回 accountId", () => {
    const t = signSession("acct-admin", "home", "secret", 1000);
    expect(verifySession(t, "secret", 1500, 10000)?.accountId).toBe("acct-admin");
  });

  it("错密钥不通过", () => {
    const t = signSession("acct-admin", "home", "secret", 1000);
    expect(verifySession(t, "WRONG", 1500, 10000)).toBeNull();
  });

  it("过期不通过", () => {
    const t = signSession("acct-admin", "home", "secret", 1000);
    expect(verifySession(t, "secret", 20000, 10000)).toBeNull();
  });

  it("未来时间不通过", () => {
    const t = signSession("acct-admin", "home", "secret", 2000);
    expect(verifySession(t, "secret", 1000, 10000)).toBeNull();
  });

  it("篡改 token 不通过", () => {
    const t = signSession("acct-admin", "home", "secret", 1000);
    expect(verifySession(t.replace("acct-admin", "acct-root"), "secret", 1500, 10000)).toBeNull();
    expect(verifySession("garbage", "secret", 1500, 10000)).toBeNull();
  });
});

describe("parseCookies", () => {
  it("解析多对", () => {
    expect(parseCookies("a=1; kp_session=tok; b=2")).toMatchObject({ a: "1", kp_session: "tok", b: "2" });
  });

  it("无头→空", () => {
    expect(parseCookies(undefined)).toEqual({});
  });
});
