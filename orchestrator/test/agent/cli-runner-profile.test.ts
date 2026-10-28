import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { CliRunner, type Backend } from "../../src/agent/cli-runner.js";
import type { ActiveProfile } from "../../src/project/profile.js";

const profileMcpConfigPath = join(mkdtempSync(join(tmpdir(), "cli-runner-profile-")), "mcp.json");
writeFileSync(profileMcpConfigPath, '{"mcpServers":{}}');

const profile = (id: string): ActiveProfile => ({
  id,
  projectsPath: `/p/${id}/projects.json`,
  credentialsPath: `/p/${id}/credentials.env`,
  credentialsEnv: {
    GITHUB_TOKEN: `tok-${id}`,
    VERCEL_TOKEN: `vercel-${id}`,
  },
  mcpConfigPath: profileMcpConfigPath,
});

describe("cli-runner profile wiring", () => {
  test("req.profileId 时 exec env 注入 profile 凭证且 claude adapter 收到 mcpConfigPath", async () => {
    const seen: { env?: Record<string, string>; args?: string[] } = {};
    const runner = new CliRunner({
      backend: "claude",
      availableBackends: new Set<Backend>(["claude"]),
      resolveProfile: profile,
      exec: async (_file, args, _cwd, env) => {
        seen.args = args;
        seen.env = env;
        return { stdout: "{\"result\":\"ok\"}", stderr: "" };
      },
    });

    await runner.run({
      stage: "implement",
      system: "",
      input: "x",
      tools: [],
      cwd: "/tmp",
      profileId: "client-x",
    });

    expect(seen.env?.GITHUB_TOKEN).toBe("tok-client-x");
    expect(seen.env?.VERCEL_TOKEN).toBe("vercel-client-x");
    expect(seen.args).toContain("--mcp-config");
    expect(seen.args).toContain(profileMcpConfigPath);
    expect(seen.args).toContain("--strict-mcp-config");
  });

  test("无 req.profileId 时: env 走白名单(不含受管凭证)且不传 mcpConfigPath", async () => {
    const seen: { env?: Record<string, string>; args?: string[] } = {};
    const runner = new CliRunner({
      backend: "claude",
      availableBackends: new Set<Backend>(["claude"]),
      resolveProfile: profile,
      exec: async (_file, args, _cwd, env) => {
        seen.args = args;
        seen.env = env;
        return { stdout: "{\"result\":\"ok\"}", stderr: "" };
      },
    });

    await runner.run({
      stage: "implement",
      system: "",
      input: "x",
      tools: [],
      cwd: "/tmp",
    });

    expect(seen.env).toBeDefined();
    expect(seen.env?.PATH).toBe(process.env.PATH);
    expect(seen.env?.GITHUB_TOKEN).toBeUndefined();
    expect(seen.env?.VERCEL_TOKEN).toBeUndefined();
    expect(seen.args).not.toContain("--mcp-config");
  });

  test("profile env 叠加 account env，并由 profile 凭证覆盖受管凭证键", async () => {
    const seen: { env?: Record<string, string> } = {};
    const runner = new CliRunner({
      backend: "claude",
      availableBackends: new Set<Backend>(["claude"]),
      accounts: [{ id: "account-a", env: { CUSTOM_KEY: "account-value", GITHUB_TOKEN: "account-gh" } }],
      resolveProfile: profile,
      exec: async (_file, _args, _cwd, env) => {
        seen.env = env;
        return { stdout: "{\"result\":\"ok\"}", stderr: "" };
      },
    });

    await runner.run({
      stage: "implement",
      system: "",
      input: "x",
      tools: [],
      cwd: "/tmp",
      profileId: "client-x",
    });

    expect(seen.env?.CUSTOM_KEY).toBe("account-value");
    expect(seen.env?.GITHUB_TOKEN).toBe("tok-client-x");
  });

  test("runStreaming 也传入 profile env 和 mcpConfigPath", async () => {
    const seen: { env?: Record<string, string>; args?: string[] } = {};
    const runner = new CliRunner({
      backend: "claude",
      availableBackends: new Set<Backend>(["claude"]),
      resolveProfile: profile,
      streamExec: async (_file, args, _cwd, onLine, env) => {
        seen.args = args;
        seen.env = env;
        onLine(JSON.stringify({ type: "result", result: "ok", usage: { input_tokens: 1, output_tokens: 2 } }));
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    });

    await runner.runStreaming({
      stage: "implement",
      system: "",
      input: "x",
      tools: [],
      cwd: "/tmp",
      profileId: "client-x",
    }, () => {});

    expect(seen.env?.GITHUB_TOKEN).toBe("tok-client-x");
    expect(seen.args).toContain("--mcp-config");
    expect(seen.args).toContain(profileMcpConfigPath);
  });
});