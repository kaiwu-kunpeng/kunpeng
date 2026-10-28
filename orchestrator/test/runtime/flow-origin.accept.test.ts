import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveFlowOrigin } from "../../src/runtime/flow-origin.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";

describe("resolveFlowOrigin", () => {
  it("Claude Code / Codex 会话 → agent，优先于 launchd 标签", () => {
    expect(resolveFlowOrigin({ CLAUDECODE: "1", XPC_SERVICE_NAME: "com.kunpeng.scout.kunpeng" })).toEqual({ by: "agent", via: "claude-code" });
    expect(resolveFlowOrigin({ CODEX_SANDBOX: "seatbelt", XPC_SERVICE_NAME: "0" })).toEqual({ by: "agent", via: "codex" });
  });
  it("cockpit 服务 → unknown", () => {
    expect(resolveFlowOrigin({ XPC_SERVICE_NAME: "com.kunpeng.serve" })).toEqual({ by: "unknown", via: "com.kunpeng.serve" });
  });
  it("鲲鹏 launchd 任务 → machine，via 为标签", () => {
    expect(resolveFlowOrigin({ XPC_SERVICE_NAME: "com.kunpeng.patrol.demo" })).toEqual({ by: "machine", via: "com.kunpeng.patrol.demo" });
  });
  it("终端 / 无标签 / 其它 launchd 任务 → human cli", () => {
    expect(resolveFlowOrigin({ XPC_SERVICE_NAME: "0" })).toEqual({ by: "human", via: "cli" });
    expect(resolveFlowOrigin({})).toEqual({ by: "human", via: "cli" });
    expect(resolveFlowOrigin({ XPC_SERVICE_NAME: "com.apple.Terminal", CODEX_HOME: "" })).toEqual({ by: "human", via: "cli" });
  });
});

describe("FlowTracker 记录来源", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-origin-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("start 按注入的环境记录来源", async () => {
    const t = new FlowTracker(dir, Date.now, { XPC_SERVICE_NAME: "com.kunpeng.scout.kunpeng" });
    await t.start("f1", "需求");
    expect((await t.read("f1"))?.startedBy).toEqual({ by: "machine", via: "com.kunpeng.scout.kunpeng" });
  });

  it("显式传入的 startedBy 优先", async () => {
    const t = new FlowTracker(dir, Date.now, { CLAUDECODE: "1" });
    await t.start("f2", "需求", { startedBy: { by: "human", via: "cockpit-button" } } as never);
    expect((await t.read("f2"))?.startedBy).toEqual({ by: "human", via: "cockpit-button" });
  });

  it("startOrResume 不覆盖已有来源，缺失时补上", async () => {
    const machine = new FlowTracker(dir, Date.now, { XPC_SERVICE_NAME: "com.kunpeng.ops.kunpeng" });
    await machine.start("f3", "需求");
    const agent = new FlowTracker(dir, Date.now, { CLAUDECODE: "1" });
    await agent.startOrResume("f3", "需求 v2");
    expect((await agent.read("f3"))?.startedBy).toEqual({ by: "machine", via: "com.kunpeng.ops.kunpeng" });

    await machine.mutate("f3", (s) => { delete s.startedBy; });
    await agent.startOrResume("f3", "需求 v3");
    expect((await agent.read("f3"))?.startedBy).toEqual({ by: "agent", via: "claude-code" });
  });

  it("两参构造照旧可用", async () => {
    const t = new FlowTracker(dir);
    await t.start("f4", "需求");
    expect((await t.read("f4"))?.startedBy?.by).toMatch(/^(human|agent|machine|unknown)$/);
  });
});