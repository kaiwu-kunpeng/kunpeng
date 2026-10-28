import { describe, it, expect } from "vitest";
import { isTrustedLocalRequest, sessionCookie } from "../../src/server/auth.js";

describe("isTrustedLocalRequest", () => {
  it("裸本机回环 → 可信", () => {
    expect(isTrustedLocalRequest({ remoteAddress: "127.0.0.1" })).toBe(true);
    expect(isTrustedLocalRequest({ remoteAddress: "::1" })).toBe(true);
  });
  it("带任一转发头（经隧道/代理）→ 不可信", () => {
    expect(isTrustedLocalRequest({ remoteAddress: "127.0.0.1", forwardedFor: "1.2.3.4" })).toBe(false);
    expect(isTrustedLocalRequest({ remoteAddress: "127.0.0.1", forwardedProto: "https" })).toBe(false);
  });
  it("非回环地址 → 不可信", () => {
    expect(isTrustedLocalRequest({ remoteAddress: "1.2.3.4" })).toBe(false);
    expect(isTrustedLocalRequest({})).toBe(false);
  });
});

describe("sessionCookie secure", () => {
  it("secure=true → 含 Secure", () => {
    expect(sessionCookie("tok", false, true)).toContain("; Secure");
  });
  it("默认不含 Secure，保持本地行为", () => {
    expect(sessionCookie("tok")).not.toContain("Secure");
    expect(sessionCookie("tok", false, false)).not.toContain("Secure");
  });
  it("仍带 HttpOnly 与 SameSite=Lax", () => {
    expect(sessionCookie("tok")).toContain("HttpOnly");
    expect(sessionCookie("tok")).toContain("SameSite=Lax");
  });
});