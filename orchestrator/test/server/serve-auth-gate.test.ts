import { describe, it, expect } from "vitest";
import { insecureServeReason } from "../../src/server/bind-host.js";

describe("B2:serve 非回环未设密码拒绝启动", () => {
  it("回环地址永不拦", () => {
    expect(insecureServeReason("127.0.0.1", false, {})).toBeUndefined();
    expect(insecureServeReason("localhost", false, {})).toBeUndefined();
    expect(insecureServeReason("::1", false, {})).toBeUndefined();
  });

  it("非回环+未设密码 → 拒绝并指引设密码;设了密码放行", () => {
    const reason = insecureServeReason("0.0.0.0", false, {});
    expect(reason).toBeDefined();
    expect(reason).toContain("auth set-password");
    expect(insecureServeReason("0.0.0.0", true, {})).toBeUndefined();
    expect(insecureServeReason("192.168.1.5", false, {})).toBeDefined();
  });

  it("KUNPENG_ALLOW_INSECURE=1 显式放行", () => {
    expect(insecureServeReason("0.0.0.0", false, { KUNPENG_ALLOW_INSECURE: "1" })).toBeUndefined();
  });
});