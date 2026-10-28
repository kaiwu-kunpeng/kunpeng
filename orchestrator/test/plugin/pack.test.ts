import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packPlugin, unpackKpkg } from "../../src/plugin/pack.js";
import { addPluginFromDir } from "../../src/cli-commands/plugin.js";
import { listPlugins, pluginsRoot } from "../../src/plugin/store.js";

let savedState: string | undefined;

beforeEach(() => {
  savedState = process.env.KUNPENG_STATE;
  process.env.KUNPENG_STATE = mkdtempSync(join(tmpdir(), "kp-kpkg-state-"));
});

afterEach(() => {
  if (savedState === undefined) delete process.env.KUNPENG_STATE;
  else process.env.KUNPENG_STATE = savedState;
});

function makePluginDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kp-kpkg-src-"));
  writeFileSync(join(dir, "kunpeng-plugin.json"), JSON.stringify({ name: "pack-demo", version: "1.2.3" }), "utf8");
  mkdirSync(join(dir, "skills", "demo"), { recursive: true });
  writeFileSync(join(dir, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: d\n---\n", "utf8");
  return dir;
}

describe("X6:.kpkg 打包", () => {
  it("pack 产包+sha256 边车,unpack 校验并还原", async () => {
    const dir = makePluginDir();
    const packed = await packPlugin(dir);
    expect(packed.path.endsWith("pack-demo-1.2.3.kpkg")).toBe(true);
    expect(existsSync(packed.path)).toBe(true);
    expect(readFileSync(`${packed.path}.sha256`, "utf8")).toContain(packed.sha256);
    const dest = mkdtempSync(join(tmpdir(), "kp-kpkg-dest-"));
    const unpacked = await unpackKpkg(packed.path, dest);
    expect(existsSync(join(unpacked, "kunpeng-plugin.json"))).toBe(true);
    expect(existsSync(join(unpacked, "skills", "demo", "SKILL.md"))).toBe(true);
  });

  it("包被篡改时按 sha256 拒绝", async () => {
    const dir = makePluginDir();
    const packed = await packPlugin(dir);
    appendFileSync(packed.path, "篡改");
    const dest = mkdtempSync(join(tmpdir(), "kp-kpkg-dest2-"));
    await expect(unpackKpkg(packed.path, dest)).rejects.toThrow(/sha256/i);
  });

  it("kpkg 解包后可走既有登记链", async () => {
    const dir = makePluginDir();
    const packed = await packPlugin(dir);
    const unpacked = await unpackKpkg(packed.path, join(pluginsRoot(), "cache"));
    const record = await addPluginFromDir(pluginsRoot(), unpacked);
    expect(record.name).toBe("pack-demo");
    expect((await listPlugins(pluginsRoot())).some((p) => p.name === "pack-demo")).toBe(true);
  });

  it("无 manifest 目录拒绝打包", async () => {
    const empty = mkdtempSync(join(tmpdir(), "kp-kpkg-empty-"));
    await expect(packPlugin(empty)).rejects.toThrow();
  });
});