import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRegistry, updateProjectOps } from "../../src/project/registry.js";

async function makeStateDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "reg-ops-"));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "projects.json"), JSON.stringify([
    { id: "acme-shop", name: "Acme", repoPath: "/tmp/x", registeredAt: 1 },
    { id: "kunpeng", name: "鲲鹏", repoPath: "/tmp/y", registeredAt: 2 },
  ], null, 2));
  return dir;
}

describe("注册表运营元数据", () => {
  it("老注册表无 ops 字段照常解析", async () => {
    const dir = await makeStateDir();
    const entries = await readRegistry(dir);
    expect(entries).toHaveLength(2);
    expect(entries[0].ops).toBeUndefined();
  });

  it("updateProjectOps 浅合并并落盘；未知 id 返回 null", async () => {
    const dir = await makeStateDir();
    const updated = await updateProjectOps(dir, "acme-shop", { northstar: { key: "pwq", label: "报价页" }, mode: "manual" });
    expect(updated?.ops?.northstar?.key).toBe("pwq");

    const merged = await updateProjectOps(dir, "acme-shop", { playbooks: ["acme-catalog"] });
    expect(merged?.ops?.playbooks).toEqual(["acme-catalog"]);
    expect(merged?.ops?.northstar?.key).toBe("pwq");
    expect(merged?.ops?.mode).toBe("manual");

    const raw = JSON.parse(await readFile(join(dir, "projects.json"), "utf8")) as Array<{ id: string; ops?: unknown }>;
    expect(raw.find((p) => p.id === "acme-shop")?.ops).toBeTruthy();
    expect(raw.find((p) => p.id === "kunpeng")?.ops).toBeUndefined();

    expect(await updateProjectOps(dir, "nope", { mode: "cron" })).toBeNull();
  });
});