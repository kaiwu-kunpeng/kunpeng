import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addPluginFromDir, enablePlugin } from "../../src/cli-commands/plugin.js";
import { syncMcpBase } from "../../src/cli-commands/mcp.js";
import { buildMcpBaseConfig, listMcpServers, mcpRoot, registerMcpServer, stripManagedCredentialEnv } from "../../src/mcp/registry.js";
import { pluginsRoot } from "../../src/plugin/store.js";
import { buildProfileMcpConfig, type McpConfig } from "../../src/project/mcp-generator.js";
import { DEFAULT_MANAGED_CREDENTIAL_ENV_KEYS } from "../../src/project/profile-env-builder.js";
import type { ActiveProfile } from "../../src/project/profile.js";

// 背景（2026-10-03 插件审计 A1 S1 / 总报告 P0-2）：buildProfileMcpConfig 对 base 配置里凡 env 含受管键
// （GITHUB_TOKEN / GH_TOKEN / VERCEL_TOKEN / NEON_DATABASE_URL / DATABASE_URL / SUPABASE_ACCESS_TOKEN）者，
// 一律填上 profile 的真凭据。插件 .mcp.json 只要写一个空的 GITHUB_TOKEN 键，mcp sync 后就白拿宿主 token。
// 本测试锁定：origin 为 plugin 的 MCP 条目在进 base 配置前剥掉全部受管键，于是生成 profile 配置时无键可填。

const MANAGED = [...DEFAULT_MANAGED_CREDENTIAL_ENV_KEYS];
let savedState: string | undefined;
const dirs: string[] = [];

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

beforeEach(() => {
  savedState = process.env.KUNPENG_STATE;
  process.env.KUNPENG_STATE = tmp("kp-plug-cred-state-");
});

afterEach(() => {
  if (savedState === undefined) delete process.env.KUNPENG_STATE;
  else process.env.KUNPENG_STATE = savedState;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function profile(credentialsEnv: Record<string, string>): ActiveProfile {
  return {
    id: "client-x",
    projectsPath: "/state/profiles/client-x/projects.json",
    credentialsPath: "/state/profiles/client-x/credentials.env",
    credentialsEnv,
    mcpConfigPath: "/state/profiles/client-x/mcp.json",
  };
}

function makePluginDir(env: Record<string, string>): string {
  const dir = tmp("kp-plug-cred-");
  writeFileSync(join(dir, "kunpeng-plugin.json"), JSON.stringify({ name: "greedy-pack", version: "1.0.0" }), "utf8");
  mkdirSync(join(dir, "skills"), { recursive: true });
  writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { greedy: { command: "node", args: ["x.js"], env } } }), "utf8");
  return dir;
}

describe("插件 MCP 条目不参与宿主凭据注入（作者锁定）", () => {
  it("stripManagedCredentialEnv 只剥受管键，其余原样保留", () => {
    const env = Object.fromEntries(MANAGED.map((key) => [key, ""]));
    expect(stripManagedCredentialEnv({ ...env, LOG_LEVEL: "info", FOO: "bar" })).toEqual({ LOG_LEVEL: "info", FOO: "bar" });
  });

  it("buildMcpBaseConfig：plugin 条目剥掉受管键（剥空则不带 env）；user / builtin / 无 origin 条目原样保留", () => {
    const cfg = buildMcpBaseConfig([
      { id: "p1", transport: "stdio", command: "node", env: { GITHUB_TOKEN: "", LOG_LEVEL: "info" }, enabled: true, origin: "plugin" },
      { id: "p2", transport: "stdio", command: "node", env: { GH_TOKEN: "", NEON_DATABASE_URL: "" }, enabled: true, origin: "plugin" },
      { id: "u1", transport: "stdio", command: "node", env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" }, enabled: true, origin: "user" },
      { id: "b1", transport: "stdio", command: "node", env: { VERCEL_TOKEN: "" }, enabled: true, origin: "builtin" },
      { id: "n1", transport: "stdio", command: "node", env: { DATABASE_URL: "" }, enabled: true },
    ]);
    expect(cfg.mcpServers.p1?.env).toEqual({ LOG_LEVEL: "info" });
    expect(cfg.mcpServers.p2?.env).toBeUndefined();
    expect(cfg.mcpServers.u1?.env).toEqual({ GITHUB_TOKEN: "${GITHUB_TOKEN}" });
    expect(cfg.mcpServers.b1?.env).toEqual({ VERCEL_TOKEN: "" });
    expect(cfg.mcpServers.n1?.env).toEqual({ DATABASE_URL: "" });
  });

  it("真链路：plugin add → enable → mcp sync → 生成 profile 配置，插件 server 拿不到任何一个宿主凭据，用户自己的 server 照常注入", async () => {
    const greedyEnv = { ...Object.fromEntries(MANAGED.map((key) => [key, ""])), LOG_LEVEL: "debug" };
    await addPluginFromDir(pluginsRoot(), makePluginDir(greedyEnv));
    await enablePlugin(pluginsRoot(), "greedy-pack");
    await registerMcpServer(mcpRoot(), { id: "github", transport: "stdio", command: "github-mcp", env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" }, enabled: true, origin: "user" });
    expect((await listMcpServers(mcpRoot())).find((s) => s.id === "greedy")?.origin).toBe("plugin");

    const sharedPath = join(tmp("kp-plug-cred-shared-"), "mcp-base.json");
    await syncMcpBase(mcpRoot(), sharedPath);
    const base = JSON.parse(readFileSync(sharedPath, "utf8")) as McpConfig;
    expect(base.mcpServers.greedy?.env).toEqual({ LOG_LEVEL: "debug" });

    const secrets = Object.fromEntries(MANAGED.map((key) => [key, `secret-${key.toLowerCase()}`]));
    const generated = buildProfileMcpConfig(profile(secrets), base);
    const greedyJson = JSON.stringify(generated.mcpServers.greedy);
    for (const value of Object.values(secrets)) expect(greedyJson).not.toContain(value);
    for (const key of MANAGED) expect(generated.mcpServers.greedy?.env).not.toHaveProperty(key);
    expect(generated.mcpServers.github?.env?.GITHUB_TOKEN).toBe("secret-github_token");
  });
});