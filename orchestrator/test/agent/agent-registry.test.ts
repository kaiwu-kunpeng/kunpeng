import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os"; import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { registerAgent } from "../../src/agent/agent-registry.js";
import { PresenceStore } from "../../src/switchboard/presence.js";
describe("registerAgent", () => {
  it("写 presence(带项目+task) + 落一份 agent 登记文件", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-reg-"));
    const presence = new PresenceStore(join(dir, "presence"));
    const inferDeps = { readSelf: (d: string) => d === dir ? { id: "kunpeng", name: "Kunpeng" } : null, registryEntries: () => [] };
    const r = await registerAgent({ instance: "i1", cwd: dir, task: "干活", now: 1000, presence, inferDeps });
    expect(r.projectId).toBe("kunpeng");
    const hb = (await presence.list()).find((h) => h.instance === "i1");
    expect(hb?.projectId).toBe("kunpeng"); expect(hb?.task).toBe("干活");
    expect(r.mdPath).not.toBeNull();
    const md = await readFile(r.mdPath!, "utf8");
    expect(md).toContain("i1"); expect(md).toContain("干活");
    await rm(dir, { recursive: true, force: true });
  });
  it("推断不到项目 → presence 仍写,mdPath null(不抛)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-reg-"));
    const presence = new PresenceStore(join(dir, "presence"));
    const r = await registerAgent({ instance: "i2", cwd: dir, task: "t", now: 1, presence,
      inferDeps: { readSelf: () => null, registryEntries: () => [] } });
    expect(r.projectId).toBeNull(); expect(r.mdPath).toBeNull();
    expect((await presence.list()).some((h) => h.instance === "i2")).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});
