import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { sanitizeAccountEnv, expandEnv, loadAccounts } from "../../src/agent/account-pool.js";

describe("sanitizeAccountEnv", () => {
  it("剔除等于默认 ~/.claude 的 CLAUDE_CONFIG_DIR 注入", () => {
    const env = sanitizeAccountEnv(expandEnv({ CLAUDE_CONFIG_DIR: "~/.claude" }));
    expect(env).not.toHaveProperty("CLAUDE_CONFIG_DIR");
  });
  it("剔除等于默认 ~/.codex 的 CODEX_HOME 注入", () => {
    const env = sanitizeAccountEnv(expandEnv({ CODEX_HOME: "~/.codex" }));
    expect(env).not.toHaveProperty("CODEX_HOME");
  });
  it("非默认目录的隔离配置原样保留", () => {
    const custom = join(homedir(), ".claude-acct2");
    const env = sanitizeAccountEnv({ CLAUDE_CONFIG_DIR: custom });
    expect(env.CLAUDE_CONFIG_DIR).toBe(custom);
  });
  it("无关键值不受影响,且不改入参", () => {
    const input = { FOO: "bar", CLAUDE_CONFIG_DIR: join(homedir(), ".claude") };
    const env = sanitizeAccountEnv(input);
    expect(env.FOO).toBe("bar");
    expect(input.CLAUDE_CONFIG_DIR).toBe(join(homedir(), ".claude"));
  });
});

describe("loadAccounts 应用消毒", () => {
  let home: string;
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), "kp-acct-")); });
  afterEach(() => { rmSync(home, { recursive: true, force: true }); });

  it("等值默认注入在加载时被剔除,自定义键保留", async () => {
    mkdirSync(join(home, ".kunpeng"), { recursive: true });
    writeFileSync(
      join(home, ".kunpeng", "accounts.json"),
      JSON.stringify([{ id: "a1", env: { CLAUDE_CONFIG_DIR: "~/.claude", MY_FLAG: "1" }, windowHours: 5 }]),
    );
    const accounts = await loadAccounts({ home });
    expect(accounts).toHaveLength(1);
    expect(accounts[0].env?.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(accounts[0].env?.MY_FLAG).toBe("1");
  });

  it("env 消毒后为空则整个 env 字段不带", async () => {
    mkdirSync(join(home, ".kunpeng"), { recursive: true });
    writeFileSync(
      join(home, ".kunpeng", "accounts.json"),
      JSON.stringify([{ id: "a1", env: { CLAUDE_CONFIG_DIR: "~/.claude", CODEX_HOME: "~/.codex" }, windowHours: 5 }]),
    );
    const accounts = await loadAccounts({ home });
    expect(accounts).toHaveLength(1);
    expect(accounts[0].env).toBeUndefined();
  });
});