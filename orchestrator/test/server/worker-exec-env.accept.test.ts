import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createShellSession } from "../../src/server/worker/shell-session.js";
import {
  ESSENTIAL_ENV_NAMES,
  SECRET_ENV_NAMES,
  SECRET_ENV_PATTERN,
  scrubExecEnv,
} from "../../src/server/worker/exec-env.js";

const MUST_DROP = [
  "GITHUB_MCP_TOKEN",
  "DRAIN_KEY",
  "INDEXNOW_KEY",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "SSH_AUTH_SOCK",
  "AWS_SECRET_ACCESS_KEY",
  "RESEND_API_KEY",
  "DATABASE_URL",
];

const MUST_KEEP = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "TERM",
  "TMPDIR",
  "NODE_ENV",
  "npm_config_registry",
  "XDG_CONFIG_HOME",
];

function sourceEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of [...MUST_DROP, ...MUST_KEEP]) env[name] = `v-${name}`;
  return env;
}

describe("scrubExecEnv 剔除凭据类变量", () => {
  it("MUST_DROP 全部不出现在结果里", () => {
    const out = scrubExecEnv(sourceEnv());
    for (const name of MUST_DROP) expect(Object.keys(out), name).not.toContain(name);
  });

  it("MUST_KEEP 全部原值保留", () => {
    const out = scrubExecEnv(sourceEnv());
    for (const name of MUST_KEEP) expect(out[name], name).toBe(`v-${name}`);
  });

  it("值内嵌凭据的连接串即使键名无害也被剔除", () => {
    const out = scrubExecEnv({ MY_CONN: "postgres://u:p@h/db", PLAIN: "https://example.com/x" });
    expect(Object.keys(out)).not.toContain("MY_CONN");
    expect(out.PLAIN).toBe("https://example.com/x");
  });

  it("ESSENTIAL 优先级高于剔除规则", () => {
    const out = scrubExecEnv({ PATH: "/usr/bin" });
    expect(out.PATH).toBe("/usr/bin");
  });

  it("纯函数：不读 process.env", () => {
    const out = scrubExecEnv({});
    expect(Object.keys(out)).toEqual([]);
  });

  it("三个规则常量都是模块级导出", () => {
    expect(SECRET_ENV_PATTERN).toBeInstanceOf(RegExp);
    expect(Array.isArray(SECRET_ENV_NAMES) || SECRET_ENV_NAMES instanceof Set).toBe(true);
    expect(Array.isArray(ESSENTIAL_ENV_NAMES) || ESSENTIAL_ENV_NAMES instanceof Set).toBe(true);
  });
});

describe("真实 shell 会话拿不到被剔除的变量", () => {
  it("env 里没有 GITHUB_MCP_TOKEN，但有 PATH，且会话仍可用", async () => {
    const session = createShellSession({
      env: { PATH: process.env.PATH, HOME: process.env.HOME, GITHUB_MCP_TOKEN: "leaked-value-xyz" },
    });
    try {
      const dumped = await session.run("env");
      expect(dumped.stdout).not.toContain("GITHUB_MCP_TOKEN");
      expect(dumped.stdout).not.toContain("leaked-value-xyz");
      expect(dumped.stdout).toContain("PATH=");

      const echoed = await session.run("echo alive");
      expect(echoed.stdout.trim()).toBe("alive");
      expect(echoed.exitCode).toBe(0);
    } finally {
      session.close();
    }
  }, 30_000);
});

describe("源码结构", () => {
  it("shell-session.ts 不再整份透传 process.env", () => {
    const src = readFileSync(
      new URL("../../src/server/worker/shell-session.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/\.\.\.process\.env/);
    expect(src).toContain("scrubExecEnv");
  });
});