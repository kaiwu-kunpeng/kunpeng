import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePluginManifest, checkMinVersion, loadPluginDir } from "../../src/plugin/manifest.js";

function makePlugin(manifest: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "kp-plugin-"));
  writeFileSync(join(dir, "kunpeng-plugin.json"), JSON.stringify(manifest), "utf8");
  return dir;
}

describe("P4a:插件 manifest", () => {
  it("合法 manifest 解析通过,坏档硬报错", () => {
    const m = parsePluginManifest(JSON.stringify({ name: "demo-pack", version: "1.0.0", description: "演示" }));
    expect(m.name).toBe("demo-pack");
    expect(m.version).toBe("1.0.0");
    expect(() => parsePluginManifest("{坏json")).toThrow();
    expect(() => parsePluginManifest(JSON.stringify({ version: "1.0.0" }))).toThrow(/name/);
    expect(() => parsePluginManifest(JSON.stringify({ name: "Bad Name", version: "1.0.0" }))).toThrow();
    expect(() => parsePluginManifest(JSON.stringify({ name: "demo", version: "abc" }))).toThrow();
  });

  it("checkMinVersion 按 semver 判定", () => {
    expect(checkMinVersion({ name: "a", version: "1.0.0" }, "0.1.0").ok).toBe(true);
    expect(checkMinVersion({ name: "a", version: "1.0.0", minKunpengVersion: "9.9.9" }, "0.1.0").ok).toBe(false);
    expect(checkMinVersion({ name: "a", version: "1.0.0", minKunpengVersion: "0.1.0" }, "0.1.0").ok).toBe(true);
  });

  it("loadPluginDir 发现技能与 mcp 声明", async () => {
    const dir = makePlugin({ name: "demo", version: "1.0.0" });
    mkdirSync(join(dir, "skills", "写作"), { recursive: true });
    writeFileSync(join(dir, "skills", "写作", "SKILL.md"), "---\nname: 写作\ndescription: d\n---\n", "utf8");
    mkdirSync(join(dir, "skills", "空目录"), { recursive: true });
    writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { x: { command: "node" } } }), "utf8");
    const loaded = await loadPluginDir(dir);
    expect(loaded.manifest.name).toBe("demo");
    expect(loaded.skillDirs.length).toBe(1);
    expect(loaded.skillDirs[0]).toContain("写作");
    expect(loaded.mcpPath).toContain(".mcp.json");
  });

  it("无 manifest / 坏 .mcp.json 都 throw", async () => {
    const empty = mkdtempSync(join(tmpdir(), "kp-plugin-empty-"));
    await expect(loadPluginDir(empty)).rejects.toThrow(/kunpeng-plugin\.json/);
    const bad = makePlugin({ name: "demo", version: "1.0.0" });
    writeFileSync(join(bad, ".mcp.json"), "{坏", "utf8");
    await expect(loadPluginDir(bad)).rejects.toThrow();
  });
});