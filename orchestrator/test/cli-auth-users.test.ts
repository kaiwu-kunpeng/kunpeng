import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import "../src/cli-commands/project-admin.js";
import { dispatchCliCommand, type CliContext } from "../src/cli-commands/registry.js";
import {
  addAccount,
  buildAuthConfig,
  findLoginAccount,
  readAuthConfig,
  writeAuthConfig,
  type AuthConfig,
} from "../src/server/auth.js";

const SEED_SECRET = "s".repeat(64);
const dirs: string[] = [];
let stateDir = "";
let exitSpy: ReturnType<typeof vi.spyOn>;

function ctx(rest: string[]): CliContext {
  return {
    repoRoot: stateDir,
    kunpengHome: stateDir,
    rest,
    argv: ["kunpeng", "auth", ...rest],
    flags: new Set<string>(),
  };
}

async function load(): Promise<AuthConfig> {
  const cfg = await readAuthConfig(stateDir);
  if (!cfg) throw new Error("auth.json 读不到");
  return cfg;
}

function names(cfg: AuthConfig): string[] {
  return cfg.accounts.map((account) => account.username).sort();
}

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "kunpeng-auth-users-"));
  dirs.push(stateDir);
  process.env.KUNPENG_STATE = stateDir;
  process.exitCode = 0;
  // 用例里 process.exit 一旦被调用就会连坐杀死 vitest worker——spy 成抛错，让回归表现为红灯而不是进程消失。
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${String(code)}) 不该被调用`);
  }) as never);

  const base = buildAuthConfig("admin", "admin-pw", {
    salt: "a".repeat(32),
    secret: SEED_SECRET,
    now: 1,
  });
  await writeAuthConfig(
    stateDir,
    addAccount(base, {
      username: "afeng",
      password: "afeng-pw",
      profileId: "home",
      role: "member",
      salt: "b".repeat(32),
      now: 2,
    }),
  );
});

afterEach(async () => {
  exitSpy.mockRestore();
  process.exitCode = 0;
  delete process.env.KUNPENG_STATE;
  delete process.env.KUNPENG_AUTH_PASSWORD;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("kunpeng auth 用户管理不得误删账号", () => {
  test("set-password 重置已有用户密码，其余账号与会话密钥原样保留", async () => {
    process.env.KUNPENG_AUTH_PASSWORD = "afeng-new";
    await dispatchCliCommand("auth", ctx(["set-password", "--user", "afeng"]));

    const cfg = await load();
    expect(names(cfg)).toEqual(["admin", "afeng"]);
    expect(cfg.secret).toBe(SEED_SECRET);
    expect(findLoginAccount(cfg, { username: "afeng", password: "afeng-new" })).not.toBeNull();
    expect(findLoginAccount(cfg, { username: "afeng", password: "afeng-pw" })).toBeNull();
    expect(findLoginAccount(cfg, { username: "admin", password: "admin-pw" })).not.toBeNull();
    expect(process.exitCode).toBe(0);
  });

  test("set-password 指向不存在的用户时拒绝执行，auth.json 一字不改", async () => {
    process.env.KUNPENG_AUTH_PASSWORD = "ghost-pw";
    await dispatchCliCommand("auth", ctx(["set-password", "--user", "ghost"]));

    const cfg = await load();
    expect(names(cfg)).toEqual(["admin", "afeng"]);
    expect(cfg.secret).toBe(SEED_SECRET);
    expect(findLoginAccount(cfg, { username: "admin", password: "admin-pw" })).not.toBeNull();
    expect(findLoginAccount(cfg, { username: "afeng", password: "afeng-pw" })).not.toBeNull();
    expect(process.exitCode).toBe(1);
  });

  test("add-user 追加新用户，既有账号全部保留且密码不变", async () => {
    process.env.KUNPENG_AUTH_PASSWORD = "kate-pw";
    await dispatchCliCommand("auth", ctx(["add-user", "kate", "--role", "member"]));

    const cfg = await load();
    expect(names(cfg)).toEqual(["admin", "afeng", "kate"]);
    expect(cfg.secret).toBe(SEED_SECRET);
    expect(findLoginAccount(cfg, { username: "kate", password: "kate-pw" })).not.toBeNull();
    expect(findLoginAccount(cfg, { username: "admin", password: "admin-pw" })).not.toBeNull();
    expect(findLoginAccount(cfg, { username: "afeng", password: "afeng-pw" })).not.toBeNull();
    expect(cfg.accounts.find((account) => account.username === "kate")?.role).toBe("member");
    expect(process.exitCode).toBe(0);
  });

  test("add-user 重名时拒绝执行，被重名账号的密码不被覆盖", async () => {
    process.env.KUNPENG_AUTH_PASSWORD = "hijack";
    await dispatchCliCommand("auth", ctx(["add-user", "afeng"]));

    const cfg = await load();
    expect(names(cfg)).toEqual(["admin", "afeng"]);
    expect(findLoginAccount(cfg, { username: "afeng", password: "afeng-pw" })).not.toBeNull();
    expect(findLoginAccount(cfg, { username: "afeng", password: "hijack" })).toBeNull();
    expect(process.exitCode).toBe(1);
  });
});