import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../src/cli-commands/plugin.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import { PLUGIN_CONTRIBUTION_KINDS, PLUGIN_HOOK_EVENTS, loadPluginDir, parsePluginManifest } from "../../src/plugin/manifest.js";
import { renderPluginValidation, validatePlugin } from "../../src/plugin/validate.js";

// 背景（2026-10-03 插件审计 A1 S2 / K1，总报告 P1-7 第一步）：manifest 只认 skills + mcp，角色卡 / 钩子 / loop 模板没有声明位；
// 没有 validate 命令，坏插件要到 enable 时才炸。本测试锁定：manifest 五类贡献字段与路径越界守卫；agents/workflows 只发现；
// hooks 形状死（只认 preMerge/sessionStart 的字符串数组）；validatePlugin 硬错/软问题分流、--strict 把软问题当错；CLI 子命令接上。

function plugin(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "kp-plugin-v-"));
  for (const [rel, body] of Object.entries(files)) { mkdirSync(join(dir, rel, ".."), { recursive: true }); writeFileSync(join(dir, rel), body); }
  return dir;
}
const manifest = (extra: Record<string, unknown> = {}) => JSON.stringify({ name: "demo-kit", version: "1.2.0", ...extra });
const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("manifest 五类贡献（作者锁定）", () => {
  it("常量；三个新字段可选且须为字符串；越界路径一律拒", async () => {
    expect(PLUGIN_CONTRIBUTION_KINDS).toEqual(["skills", "agents", "hooks", "mcp", "workflows"]);
    expect(PLUGIN_HOOK_EVENTS).toEqual(["preMerge", "sessionStart"]);
    expect(parsePluginManifest(manifest({ agentsDir: "roles", hooksConfig: "h.json", workflowsDir: "wf" }))).toEqual({ name: "demo-kit", version: "1.2.0", agentsDir: "roles", hooksConfig: "h.json", workflowsDir: "wf" });
    expect(parsePluginManifest(manifest())).toEqual({ name: "demo-kit", version: "1.2.0" });
    expect(() => parsePluginManifest(manifest({ agentsDir: 3 }))).toThrow(/agentsDir/);
    for (const field of ["agentsDir", "hooksConfig", "workflowsDir"]) {
      const d = plugin({ "kunpeng-plugin.json": manifest({ [field]: "../../etc" }) }); dirs.push(d);
      await expect(loadPluginDir(d), field).rejects.toThrow(new RegExp(`"${field}" must stay inside`));
    }
  });

  it("loadPluginDir 发现 agents(*.role.md) / workflows(*.md) / hooks；缺目录为空；坏 hooks 形状报错", async () => {
    const d = plugin({
      "kunpeng-plugin.json": manifest({ description: "d", minKunpengVersion: "0.1.0" }),
      "skills/writer/SKILL.md": "---\nname: writer\n---\n", "agents/reviewer.role.md": "---\nrole: reviewer\n---\n", "agents/notes.txt": "x",
      "workflows/geo-sweep.md": "# wf\n", "workflows/README.txt": "x", "hooks.json": JSON.stringify({ preMerge: ["npm test"], sessionStart: [] }),
    }); dirs.push(d);
    const loaded = await loadPluginDir(d);
    expect(loaded.skillDirs.map((p) => p.split("/").pop())).toEqual(["writer"]);
    expect(loaded.agentFiles.map((p) => p.split("/").pop())).toEqual(["reviewer.role.md"]);
    expect(loaded.workflowFiles.map((p) => p.split("/").pop())).toEqual(["geo-sweep.md"]);
    expect(loaded.hooks).toEqual({ preMerge: ["npm test"], sessionStart: [] });
    expect(loaded.hooksPath).toBe(join(d, "hooks.json"));
    const bare = plugin({ "kunpeng-plugin.json": manifest() }); dirs.push(bare);
    expect(await loadPluginDir(bare)).toMatchObject({ agentFiles: [], workflowFiles: [] });
    expect((await loadPluginDir(bare)).hooks).toBeUndefined();
    const badKey = plugin({ "kunpeng-plugin.json": manifest(), "hooks.json": JSON.stringify({ postMerge: ["x"] }) }); dirs.push(badKey);
    await expect(loadPluginDir(badKey)).rejects.toThrow(/unknown hook event "postMerge"/);
    const badShape = plugin({ "kunpeng-plugin.json": manifest(), "hooks.json": JSON.stringify({ preMerge: "npm test" }) }); dirs.push(badShape);
    await expect(loadPluginDir(badShape)).rejects.toThrow(/"preMerge" must be an array/);
    const badJson = plugin({ "kunpeng-plugin.json": manifest(), "hooks.json": "{nope" }); dirs.push(badJson);
    await expect(loadPluginDir(badJson)).rejects.toThrow(/invalid hooks config/);
  });
});

describe("validatePlugin 与 CLI（作者锁定）", () => {
  it("硬错拦；软问题默认只警告，--strict 当错；贡献计数；渲染", async () => {
    const broken = plugin({ "kunpeng-plugin.json": "{bad" }); dirs.push(broken);
    const r0 = await validatePlugin(broken);
    expect(r0.ok).toBe(false);
    expect(r0.errors).toHaveLength(1);
    expect(r0.loaded).toBeUndefined();
    const soft = plugin({ "kunpeng-plugin.json": manifest(), "hooks.json": JSON.stringify({ preMerge: ["a", "b"] }) }); dirs.push(soft);
    const r1 = await validatePlugin(soft);
    expect(r1.ok).toBe(true);
    expect(r1.errors).toEqual([]);
    expect(r1.warnings.map((w) => w.split("：")[0])).toEqual(["缺 description", "缺 minKunpengVersion", "带 2 条 hooks（会跑 shell）"]);
    expect(r1.contributions).toEqual({ skills: 0, agents: 0, hooks: 2, mcp: 0, workflows: 0 });
    const r1s = await validatePlugin(soft, { strict: true });
    expect(r1s.ok).toBe(false);
    expect(r1s.strict).toBe(true);
    expect(renderPluginValidation(r1s)).toContain("✗ demo-kit@1.2.0 [strict]");
    expect(renderPluginValidation(r1s)).toContain("错误(strict): 缺 description");
    const empty = plugin({ "kunpeng-plugin.json": manifest({ description: "d", minKunpengVersion: "0.1.0" }) }); dirs.push(empty);
    expect((await validatePlugin(empty)).warnings).toEqual(["空壳插件：skills / agents / hooks / mcp / workflows 一个都没有"]);
    const full = plugin({ "kunpeng-plugin.json": manifest({ description: "d", minKunpengVersion: "0.1.0" }), "skills/w/SKILL.md": "x", "agents/r.role.md": "x", "workflows/a.md": "x", "workflows/b.md": "x", ".mcp.json": JSON.stringify({ mcpServers: { x: { command: "node" } } }) }); dirs.push(full);
    const rf = await validatePlugin(full, { strict: true });
    expect(rf).toMatchObject({ ok: true, warnings: [], contributions: { skills: 1, agents: 1, hooks: 0, mcp: 1, workflows: 2 } });
    expect(renderPluginValidation(rf)).toContain("贡献: skills=1 agents=1 hooks=0 mcp=1 workflows=2");
    const old = await validatePlugin(full, { currentVersion: "0.0.1" });
    expect(old.ok).toBe(false);
    expect(old.errors[0]).toContain("minKunpengVersion 不满足");
  });

  it("kunpeng plugin validate <dir> [--strict]：打印报告，不通过 exitCode=1；用法文本含 validate", async () => {
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => { out.push(line); });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const command = listCliCommands().find((c) => c.name === "plugin")!;
    const soft = plugin({ "kunpeng-plugin.json": manifest(), "skills/w/SKILL.md": "x" }); dirs.push(soft);
    process.exitCode = 0;
    await command.run({ repoRoot: soft, rest: ["validate", soft], argv: ["plugin", "validate", soft] } as never);
    expect(process.exitCode).toBe(0);
    expect(out.join("\n")).toContain("✓ demo-kit@1.2.0");
    expect(out.join("\n")).toContain("警告: 缺 description");
    out.length = 0;
    await command.run({ repoRoot: soft, rest: ["validate", soft, "--strict"], argv: ["plugin", "validate", soft, "--strict"] } as never);
    expect(process.exitCode).toBe(1);
    expect(out.join("\n")).toContain("✗ demo-kit@1.2.0 [strict]");
    process.exitCode = 0;
  });
});