import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os"; import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { PresenceStore } from "../../src/switchboard/presence.js";
describe("presence 带 projectId/worktree/task", () => {
  it("beat 带 meta 持久化、list 取回", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-pres-"));
    const s = new PresenceStore(dir);
    await s.beat("acct-iso-chat", 100, { projectId: "kunpeng", worktree: "/Users/x/kunpeng", task: "建注册机制" });
    const hb = (await s.list()).find((h) => h.instance === "acct-iso-chat");
    expect(hb?.projectId).toBe("kunpeng"); expect(hb?.worktree).toBe("/Users/x/kunpeng"); expect(hb?.task).toBe("建注册机制");
    await rm(dir, { recursive: true, force: true });
  });
  it("beat 不带 meta 仍可(向后兼容)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-pres-"));
    const s = new PresenceStore(dir);
    await s.beat("x", 1);
    expect((await s.list())[0].instance).toBe("x");
    await rm(dir, { recursive: true, force: true });
  });
});
