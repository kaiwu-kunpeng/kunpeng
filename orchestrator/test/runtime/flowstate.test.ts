import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowTracker } from "../../src/runtime/flowstate.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-flowstate-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("FlowTracker.startOrResume", () => {
  it("续跑保留 history（不再抹除），状态置回 running", async () => {
    const t = new FlowTracker(dir);
    await t.start("f1", "需求A");
    await t.enter("f1", "implement", true);
    const before = await t.read("f1");
    expect(before).not.toBeNull();
    const stagesBefore = before!.history.map((h) => h.stage);
    expect(stagesBefore).toContain("spec");
    expect(stagesBefore).toContain("implement");
    const startedAt = before!.startedAt;

    await t.startOrResume("f1", "需求A");
    const after = await t.read("f1");
    expect(after).not.toBeNull();
    // history 必须原样保留（含 implement），不被抹回单一 spec
    expect(after!.history.map((h) => h.stage)).toEqual(stagesBefore);
    expect(after!.status).toBe("running");
    expect(after!.agentActive).toBe(false);
    // startedAt 保留（非重置）
    expect(after!.startedAt).toBe(startedAt);
  });

  it("对照：旧 start() 会把 history 抹回单一 spec", async () => {
    const t = new FlowTracker(dir);
    await t.start("f2", "需求B");
    await t.enter("f2", "implement", true);
    await t.start("f2", "需求B"); // 重新 start = 抹除
    const after = await t.read("f2");
    expect(after!.history.map((h) => h.stage)).toEqual(["spec"]);
  });

  it("全新流：startOrResume 等价 start（history=[spec], running）", async () => {
    const t = new FlowTracker(dir);
    await t.startOrResume("f3", "需求C", { planId: "p1", phase: 2 });
    const s = await t.read("f3");
    expect(s).not.toBeNull();
    expect(s!.history.map((h) => h.stage)).toEqual(["spec"]);
    expect(s!.status).toBe("running");
    expect(s!.stage).toBe("spec");
    expect(s!.planId).toBe("p1");
    expect(s!.phase).toBe(2);
  });

  it("续跑时 extra 覆盖旧字段、requirement 更新", async () => {
    const t = new FlowTracker(dir);
    await t.start("f4", "旧需求", { logPath: "/old/log" });
    await t.enter("f4", "verify", false);
    await t.startOrResume("f4", "新需求", { logPath: "/new/log" });
    const s = await t.read("f4");
    expect(s!.requirement).toBe("新需求");
    expect(s!.logPath).toBe("/new/log");
    // 续跑仍保留 verify 历史
    expect(s!.history.map((h) => h.stage)).toContain("verify");
  });
});