import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listPlugins, upsertPlugin, setPluginEnabled, removePlugin } from "../../src/plugin/store.js";

describe("P4b1:插件登记表", () => {
  it("增改启停删全链路", async () => {
    const root = mkdtempSync(join(tmpdir(), "kp-plug-store-"));
    expect(await listPlugins(root)).toEqual([]);
    await upsertPlugin(root, { name: "demo-pack", version: "1.0.0", dir: "/x/demo", enabled: false });
    await upsertPlugin(root, { name: "demo-pack", version: "1.1.0", dir: "/x/demo", enabled: false });
    const all = await listPlugins(root);
    expect(all.length).toBe(1);
    expect(all[0]?.version).toBe("1.1.0");
    const enabled = await setPluginEnabled(root, "demo-pack", true, { skills: ["写作"], mcpIds: ["demomcp"] });
    expect(enabled.enabled).toBe(true);
    expect(enabled.skills).toEqual(["写作"]);
    expect(enabled.mcpIds).toEqual(["demomcp"]);
    const removed = await removePlugin(root, "demo-pack");
    expect(removed.name).toBe("demo-pack");
    expect(await listPlugins(root)).toEqual([]);
  });

  it("非法名/未知名/坏档硬报错", async () => {
    const root = mkdtempSync(join(tmpdir(), "kp-plug-store2-"));
    await expect(upsertPlugin(root, { name: "Bad Name", version: "1.0.0", dir: "/x", enabled: false })).rejects.toThrow();
    await expect(setPluginEnabled(root, "ghost", true)).rejects.toThrow(/ghost/);
    await expect(removePlugin(root, "ghost")).rejects.toThrow(/ghost/);
    const bad = mkdtempSync(join(tmpdir(), "kp-plug-store3-"));
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, "index.json"), "{坏", "utf8");
    await expect(listPlugins(bad)).rejects.toThrow();
  });
});