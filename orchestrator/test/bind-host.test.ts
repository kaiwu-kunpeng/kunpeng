import { describe, it, expect } from "vitest";
import { resolveBindHost, accessHint } from "../src/server/bind-host.js";

describe("resolveBindHost", () => {
  it("默认 127.0.0.1(都没给)", () => {
    expect(resolveBindHost(undefined, undefined)).toBe("127.0.0.1");
    expect(resolveBindHost("", "")).toBe("127.0.0.1");
  });
  it("--host 0.0.0.0 / lan / all 归一成 0.0.0.0", () => {
    expect(resolveBindHost("0.0.0.0", undefined)).toBe("0.0.0.0");
    expect(resolveBindHost("lan", undefined)).toBe("0.0.0.0");
    expect(resolveBindHost("ALL", undefined)).toBe("0.0.0.0");
  });
  it("flag 优先于 env", () => {
    expect(resolveBindHost("0.0.0.0", "127.0.0.1")).toBe("0.0.0.0");
    expect(resolveBindHost(undefined, "0.0.0.0")).toBe("0.0.0.0");
  });
  it("显式网卡 IP 原样返回", () => {
    expect(resolveBindHost("192.168.8.229", undefined)).toBe("192.168.8.229");
  });
});

describe("accessHint", () => {
  it("0.0.0.0 给局域网提示", () => {
    const h = accessHint("0.0.0.0", 7788, "192.168.8.229");
    expect(h).toContain("192.168.8.229:7788");
    expect(h).toContain("同 WiFi");
  });
  it("127.0.0.1 提示仅本机", () => {
    expect(accessHint("127.0.0.1", 7788)).toContain("仅本机");
  });
});
