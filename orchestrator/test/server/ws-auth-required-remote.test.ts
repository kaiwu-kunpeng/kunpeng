import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { isTrustedLocalRequest } from "../../src/server/auth.js";

const ptySrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "server", "pty-endpoint.ts"),
  "utf8",
);

describe("隧道感知的本机判定", () => {
  it("127.0.0.1 且无 forwarded 头 → 可信本机", () => {
    expect(isTrustedLocalRequest({ remoteAddress: "127.0.0.1" })).toBe(true);
  });

  it("::1 也算本机", () => {
    expect(isTrustedLocalRequest({ remoteAddress: "::1" })).toBe(true);
  });

  it("127.0.0.1 但带 x-forwarded-for → 不可信（隧道特征）", () => {
    expect(isTrustedLocalRequest({ remoteAddress: "127.0.0.1", forwardedFor: "1.2.3.4" })).toBe(false);
  });

  it("127.0.0.1 但带 x-forwarded-proto → 不可信", () => {
    expect(isTrustedLocalRequest({ remoteAddress: "127.0.0.1", forwardedProto: "https" })).toBe(false);
  });

  it("非环回地址 → 不可信", () => {
    expect(isTrustedLocalRequest({ remoteAddress: "10.0.0.5" })).toBe(false);
  });

  it("地址缺失 → 不可信", () => {
    expect(isTrustedLocalRequest({})).toBe(false);
  });
});

describe("upgrade 处理器确实消费了它", () => {
  it("引用了 isTrustedLocalRequest", () => {
    expect(ptySrc).toContain("isTrustedLocalRequest");
  });

  it("位置在 readAuthConfig 之后、工作区授权之前", () => {
    const authIdx = ptySrc.indexOf("readAuthConfig");
    const trustIdx = ptySrc.indexOf("isTrustedLocalRequest(");
    const wsAuthIdx = ptySrc.indexOf("authorizeWorkspaceInProfile");
    expect(authIdx).toBeGreaterThan(-1);
    expect(trustIdx).toBeGreaterThan(authIdx);
    expect(wsAuthIdx).toBeGreaterThan(trustIdx);
  });

  it("Origin 校验仍在最前", () => {
    expect(ptySrc.indexOf("isAllowedWsOrigin")).toBeLessThan(ptySrc.indexOf("readAuthConfig"));
  });

  it("有明确的拒绝告警文案", () => {
    expect(ptySrc).toContain("未启用鉴权且非本机直连");
  });

  it("读了 forwarded 两个头", () => {
    expect(ptySrc).toContain("x-forwarded-for");
    expect(ptySrc).toContain("x-forwarded-proto");
  });
});