import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkAccountEnvHealth, pickAccount, type Account } from "../../src/agent/account-pool.js";
import { QuotaTracker } from "../../src/agent/quota-tracker.js";

afterEach(() => { vi.restoreAllMocks(); });

function goodDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kp-cred-"));
  writeFileSync(join(dir, "auth.json"), "{}", "utf8");
  return dir;
}

describe("账号 A2:登录态预检 fail-fast", () => {
  it("checkAccountEnvHealth:无注入健康;坏目录/空目录不健康;非空目录健康", () => {
    expect(checkAccountEnvHealth(undefined).ok).toBe(true);
    const missing = checkAccountEnvHealth({ CLAUDE_CONFIG_DIR: "/nonexistent/kp-x" });
    expect(missing.ok).toBe(false);
    expect(missing.reason).toContain("/nonexistent/kp-x");
    expect(checkAccountEnvHealth({ CODEX_HOME: mkdtempSync(join(tmpdir(), "kp-empty-")) }).ok).toBe(false);
    expect(checkAccountEnvHealth({ CLAUDE_CONFIG_DIR: goodDir() }).ok).toBe(true);
  });

  it("pickAccount:跳过坏账号并 warn,选中健康账号;全坏 throw", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad: Account = { id: "a-bad", env: { CLAUDE_CONFIG_DIR: "/nonexistent/kp-bad" } };
    const good: Account = { id: "a-good", env: { CLAUDE_CONFIG_DIR: goodDir() } };
    const quota = new QuotaTracker();
    expect(pickAccount([bad, good], quota, 0)?.id).toBe("a-good");
    expect(warn.mock.calls.some((c) => String(c[0]).includes("a-bad") && String(c[0]).includes("预检失败"))).toBe(true);
    expect(() => pickAccount([bad], quota, 0)).toThrow(/登录态预检失败/);
  });

  it("无 env 账号不受预检影响(现网形态零变化)", () => {
    const plain: Account = { id: "acct-1" };
    expect(pickAccount([plain], new QuotaTracker(), 0)?.id).toBe("acct-1");
  });
});