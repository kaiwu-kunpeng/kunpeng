import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../../src/cli-commands/accounts.js";
import { dispatchCliCommand, type CliContext } from "../../src/cli-commands/registry.js";
import { resolveAccounts } from "../../src/agent/account-pool.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kp-acct-home-"));
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

function ctx(rest: string[]): CliContext {
  return { repoRoot: home, kunpengHome: home, rest, argv: rest, flags: new Set<string>() };
}

function credDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kp-acct-cred-"));
  writeFileSync(join(dir, "auth.json"), "{}", "utf8");
  return dir;
}

describe("kunpeng account 管理命令", () => {
  it("add→list→doctor→remove 全链路", async () => {
    const dir = credDir();
    expect(await dispatchCliCommand("account", ctx(["add", "alice", "--backend", "claude", "--cred-dir", dir]))).toBe(true);
    const path = join(home, ".kunpeng", "accounts.json");
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown[];
    const [acct] = resolveAccounts(raw);
    expect(acct.name).toBe("alice");
    expect(acct.backend).toBe("claude");
    expect(acct.env?.CLAUDE_CONFIG_DIR).toBe(dir);

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await dispatchCliCommand("account", ctx(["list"]));
    expect(log.mock.calls.some((c) => String(c[0]).includes("alice"))).toBe(true);
    log.mockClear();
    await dispatchCliCommand("account", ctx(["doctor"]));
    expect(log.mock.calls.some((c) => String(c[0]).includes("✓") && String(c[0]).includes("alice"))).toBe(true);

    await dispatchCliCommand("account", ctx(["remove", "alice"]));
    expect((JSON.parse(readFileSync(path, "utf8")) as unknown[]).length).toBe(0);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("重复 add 报错 exitCode=1,不写坏文件;remove 不存在报错", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await dispatchCliCommand("account", ctx(["add", "bob", "--backend", "codex"]));
    await dispatchCliCommand("account", ctx(["add", "bob", "--backend", "codex"]));
    expect(process.exitCode).toBe(1);
    expect(err.mock.calls.some((c) => String(c[0]).includes("已存在"))).toBe(true);
    const raw = JSON.parse(readFileSync(join(home, ".kunpeng", "accounts.json"), "utf8")) as unknown[];
    expect(raw.length).toBe(1);
    process.exitCode = undefined;
    await dispatchCliCommand("account", ctx(["remove", "nobody"]));
    expect(process.exitCode).toBe(1);
  });

  it("无子命令打印用法,不创建文件", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await dispatchCliCommand("account", ctx([]));
    expect(err.mock.calls.some((c) => String(c[0]).includes("用法"))).toBe(true);
    expect(existsSync(join(home, ".kunpeng", "accounts.json"))).toBe(false);
  });
});