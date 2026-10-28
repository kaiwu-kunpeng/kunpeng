import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os"; import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { FlowTracker } from "../../src/runtime/flowstate.js";
describe("FlowState.profileId", () => {
  it("start 带 profileId 持久化", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-fs-"));
    const t = new FlowTracker(dir, () => 1);
    await t.start("f1", "需求", { profileId: "client-x" });
    const s = await t.read("f1");
    expect(s?.profileId).toBe("client-x");
    await rm(dir, { recursive: true, force: true });
  });
  it("不带 profileId 仍可 start(向后兼容)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-fs-"));
    const t = new FlowTracker(dir, () => 1);
    await t.start("f2", "需求");
    expect((await t.read("f2"))?.flowId).toBe("f2");
    await rm(dir, { recursive: true, force: true });
  });
});
