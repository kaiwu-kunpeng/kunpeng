import { describe, it, expect } from "vitest";
import { isPrivateIp, assertPublicHttpUrl } from "../../src/util/ssrf-guard.js";

describe("isPrivateIp", () => {
  it("私网/回环/link-local → true", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.5.9", "192.168.0.1", "169.254.169.254", "0.0.0.0", "::1"]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });
  it("公网 → false", () => {
    expect(isPrivateIp("93.184.216.34")).toBe(false);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
  });
});

describe("assertPublicHttpUrl", () => {
  it("云元数据 link-local 字面量 → reject", async () => {
    await expect(assertPublicHttpUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow();
  });
  it("非 http(s) scheme → reject", async () => {
    await expect(assertPublicHttpUrl("ftp://example.com/")).rejects.toThrow();
    await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toThrow();
  });
  it("域名 DNS 解析到私网 IP → reject", async () => {
    await expect(assertPublicHttpUrl("http://evil.example/", { lookup: async () => ["10.0.0.5"] })).rejects.toThrow();
  });
  it("域名解析到公网 IP → resolve", async () => {
    await expect(assertPublicHttpUrl("http://example.com/", { lookup: async () => ["93.184.216.34"] })).resolves.toBeUndefined();
  });
});