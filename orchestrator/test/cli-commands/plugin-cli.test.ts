import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../../src/cli-commands/plugin.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import { addPluginFromDir, enablePlugin } from "../../src/cli-commands/plugin.js";
import { listPlugins, pluginsRoot } from "../../src/plugin/store.js";
import { listSkills, skillsRoot } from "../../src/skills/registry.js";
import { listMcpServers, mcpRoot } from "../../src/mcp/registry.js";

let savedState: string | undefined;

beforeEach(() => {
  savedState = process.env.KUNPENG_STATE;
  process.env.KUNPENG_STATE = mkdtempSync(join(tmpdir(), "kp-plug-state-"));
});

afterEach(() => {
  if (savedState === undefined) delete process.env.KUNPENG_STATE;
  else process.env.KUNPENG_STATE = savedState;
});

function makePluginDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kp-pack-"));
  writeFileSync(join(dir, "kunpeng-plugin.json"), JSON.stringify({ name: "demo-pack", version: "1.0.0" }), "utf8");
  mkdirSync(join(dir, "skills", "demo-skill"), { recursive: true });
  writeFileSync(join(dir, "skills", "demo-skill", "SKILL.md"), "---\nname: demo-skill\ndescription: 演示技能\n---\n演示正文\n", "utf8");
  writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { demomcp: { command: "node", args: ["x.js"] } } }), "utf8");
  return dir;
}

describe("P4b2:kunpeng plugin 命令组", () => {
  it("plugin 命令已注册", () => {
    expect(listCliCommands().some((c) => c.name === "plugin")).toBe(true);
  });

  it("add 登记但不启用;enable 自动注册技能与 MCP", async () => {
    const dir = makePluginDir();
    const added = await addPluginFromDir(pluginsRoot(), dir);
    expect(added.name).toBe("demo-pack");
    expect(added.enabled).toBe(false);
    const rec = await enablePlugin(pluginsRoot(), "demo-pack");
    expect(rec.enabled).toBe(true);
    const plugins = await listPlugins(pluginsRoot());
    expect(plugins[0]?.enabled).toBe(true);
    const skills = await Promise.resolve(listSkills(skillsRoot()));
    expect(skills.some((s) => s.dir.includes("demo-skill"))).toBe(true);
    const servers = await listMcpServers(mcpRoot());
    expect(servers.some((m) => m.id === "demomcp" && m.enabled && m.origin === "plugin")).toBe(true);
  });

  it("minKunpengVersion 不满足时 add 报错", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-pack-hi-"));
    writeFileSync(join(dir, "kunpeng-plugin.json"), JSON.stringify({ name: "future-pack", version: "1.0.0", minKunpengVersion: "999.0.0" }), "utf8");
    await expect(addPluginFromDir(pluginsRoot(), dir)).rejects.toThrow();
  });
});