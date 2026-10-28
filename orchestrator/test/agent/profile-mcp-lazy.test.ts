import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProfileMcpConfig, writeProfileMcpConfig } from "../../src/project/mcp-generator.js";
import type { ActiveProfile } from "../../src/project/profile.js";

const testDir = dirname(fileURLToPath(import.meta.url));

function fakeProfile(dir: string): ActiveProfile {
  return {
    id: "t1",
    projectsPath: join(dir, "projects.json"),
    credentialsPath: join(dir, "credentials.env"),
    credentialsEnv: { GITHUB_TOKEN: "tok-123" },
    mcpConfigPath: join(dir, "mcp.json"),
  };
}

describe("profile mcp 惰性生成链路", () => {
  it("凭据注入 base 配置并落盘", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-pmcp-"));
    const profile = fakeProfile(dir);
    const base = { mcpServers: { gh: { command: "gh-mcp", env: { GITHUB_TOKEN: "" } } } };
    const written = await writeProfileMcpConfig(profile, base);
    expect(written).toBe(profile.mcpConfigPath);
    const cfg = JSON.parse(readFileSync(profile.mcpConfigPath, "utf8"));
    expect(cfg.mcpServers.gh.env.GITHUB_TOKEN).toBe("tok-123");
  });

  it("cli-runner 悬空守卫与惰性生成已接线(源码断言)", () => {
    const src = readFileSync(join(testDir, "..", "..", "src", "agent", "cli-runner.ts"), "utf8");
    expect(src).toContain("ensureProfileMcp");
    expect(src).toContain("mcp-base.json");
    expect(src).toContain("writeProfileMcpConfig");
    expect(src).toMatch(/existsSync\(profile\.mcpConfigPath\)\s*\?\s*profile\.mcpConfigPath\s*:\s*undefined/);
  });

  it("buildProfileMcpConfig 幂等语义:base 不被原地修改", () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-pmcp2-"));
    mkdirSync(dir, { recursive: true });
    const base = { mcpServers: { gh: { command: "gh-mcp", env: { GITHUB_TOKEN: "" } } } };
    const before = JSON.stringify(base);
    buildProfileMcpConfig(fakeProfile(dir), base);
    expect(JSON.stringify(base)).toBe(before);
    writeFileSync(join(dir, "keep"), "");
    expect(existsSync(join(dir, "keep"))).toBe(true);
  });
});