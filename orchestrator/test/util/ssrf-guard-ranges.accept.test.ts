import { describe, expect, it } from "vitest";
import { assertPublicHttpUrl, isPrivateIp } from "../../src/util/ssrf-guard.js";

describe("isPrivateIp 补齐保留段（作者锁定）", () => {
  it.each([
    "0.1.2.3",
    "100.64.0.1",
    "100.100.100.100",
    "100.127.255.254",
    "192.0.0.8",
    "198.18.0.1",
    "198.19.255.255",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
    "fec0::1",
    "ff02::1",
    "64:ff9b::7f00:1",
    "64:ff9b::a00:5",
    "64:ff9b::192.168.1.1",
    "::7f00:1",
    "::10.0.0.1",
  ])("%s → true", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "93.184.216.34",
    "100.63.255.255",
    "100.128.0.1",
    "198.17.255.255",
    "198.20.0.1",
    "223.255.255.255",
    "2606:4700::1111",
    "64:ff9b::808:808",
  ])("%s → false", (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });

  it("既有判定不变", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.5.9", "192.168.0.1", "169.254.169.254", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });

  it("assertPublicHttpUrl 拒绝解析到 CGNAT / NAT64 私网的域名", async () => {
    await expect(assertPublicHttpUrl("http://a.example/", { lookup: async () => ["100.100.100.100"] })).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://b.example/", { lookup: async () => ["64:ff9b::7f00:1"] })).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://c.example/", { lookup: async () => ["8.8.8.8"] })).resolves.toBeUndefined();
  });
});