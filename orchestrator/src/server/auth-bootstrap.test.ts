import { describe, it, expect } from "vitest";
import { bootstrapAuthConfig, findLoginAccount } from "./auth.js";

describe("bootstrapAuthConfig", () => {
  it("生成可登录的随机密码配置", () => {
    let seq = 0;
    const { config, plainPassword } = bootstrapAuthConfig({ randomHex: (n) => "a".repeat(n * 2) + String(seq++), now: 1000 });
    expect(plainPassword.length).toBeGreaterThan(0);
    expect(config.accounts.length).toBe(1);
    // 用返回的明文密码能登录该账号
    const acct = findLoginAccount(config, { username: config.accounts[0].username, password: plainPassword });
    expect(acct).not.toBeNull();
  });
  it("错误密码登录失败", () => {
    const { config } = bootstrapAuthConfig({ randomHex: (n) => "b".repeat(n * 2), now: 2000, username: "admin" });
    expect(findLoginAccount(config, { username: "admin", password: "wrong" })).toBeNull();
  });
});