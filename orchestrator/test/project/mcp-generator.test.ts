import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { buildProfileMcpConfig, writeProfileMcpConfig, type McpConfig } from "../../src/project/mcp-generator.js";
import type { ActiveProfile } from "../../src/project/profile.js";

let tmp: string;

const baseConfig: McpConfig = {
  mcpServers: {
    github: {
      command: "github-mcp",
      args: ["stdio"],
      env: { GITHUB_TOKEN: "global-gh", LOG_LEVEL: "info" },
    },
    vercel: {
      command: "vercel-mcp",
      env: { VERCEL_TOKEN: "global-vercel" },
    },
    xcrawl: {
      url: "https://mcp.xcrawl.com/xc-token/mcp",
    },
  },
  globalShortcut: "keep-me",
};

function profile(credentialsEnv: Record<string, string>, mcpConfigPath = "/state/profiles/client-x/mcp.json"): ActiveProfile {
  return {
    id: "client-x",
    projectsPath: "/state/profiles/client-x/projects.json",
    credentialsPath: "/state/profiles/client-x/credentials.env",
    credentialsEnv,
    mcpConfigPath,
  };
}

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "kp-mcp-generator-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("buildProfileMcpConfig", () => {
  test("保留全套 MCP server，同时用 profile 凭证替换受管 env", () => {
    const config = buildProfileMcpConfig(profile({ GITHUB_TOKEN: "profile-gh", VERCEL_TOKEN: "profile-vercel" }), baseConfig);

    expect(Object.keys(config.mcpServers)).toEqual(["github", "vercel", "xcrawl"]);
    expect(config.mcpServers.github?.env).toEqual({
      GITHUB_TOKEN: "profile-gh",
      LOG_LEVEL: "info",
    });
    expect(config.mcpServers.vercel?.env?.VERCEL_TOKEN).toBe("profile-vercel");
    expect(config.mcpServers.xcrawl?.url).toBe("https://mcp.xcrawl.com/xc-token/mcp");
    expect(config.globalShortcut).toBe("keep-me");
  });

  test("profile 缺少的受管凭证显式清空，避免 strict MCP 继承全局 token", () => {
    const config = buildProfileMcpConfig(profile({ GITHUB_TOKEN: "profile-gh" }), baseConfig);

    expect(config.mcpServers.github?.env?.GITHUB_TOKEN).toBe("profile-gh");
    expect(config.mcpServers.vercel?.env?.VERCEL_TOKEN).toBe("");
  });

  test("不会修改传入的基础模板", () => {
    const original = JSON.stringify(baseConfig);

    buildProfileMcpConfig(profile({ GITHUB_TOKEN: "profile-gh" }), baseConfig);

    expect(JSON.stringify(baseConfig)).toBe(original);
  });
});

test("writeProfileMcpConfig writes profile mcp.json", async () => {
  const out = join(tmp, "profiles", "client-x", "mcp.json");
  await expect(writeProfileMcpConfig(profile({ VERCEL_TOKEN: "profile-vercel" }, out), baseConfig)).resolves.toBe(out);

  const written = JSON.parse(await readFile(out, "utf8")) as McpConfig;
  expect(written.mcpServers.vercel?.env?.VERCEL_TOKEN).toBe("profile-vercel");
  expect(written.mcpServers.xcrawl?.url).toBe("https://mcp.xcrawl.com/xc-token/mcp");
});
