import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { FakeRunner } from "../../src/agent/runner.js";
import { Workspace } from "../../src/git/workspace.js";
import { DevCycle } from "../../src/loop/dev-cycle.js";
import { runLoopWave } from "../../src/loop/driver.js";
import type { LoopDef } from "../../src/loop/types.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { createLogger } from "../../src/runtime/logger.js";
import { BUILTIN_MCP_SERVERS, withSwitchboardMcp } from "../../src/server/localfs/chat-wiring.js";
import { fileSwitchboardSender } from "../../src/switchboard/default-sender.js";
import { newMessage, SwitchboardStore, type NewMessageInput } from "../../src/switchboard/store.js";

// 背景（2026-10-03 通讯审计 A2 S2-5，ADR-0018 / P1-2）：A2A 任务层三个月零消费者——dev-cycle 的 failure、driver 的 idle 通知
// 依赖可选 deps.switchboard，生产 8 处调用点全部没注入；switchboard-mcp 没注册给任何对话 agent；消息没有来源字段。
// 本测试锁定：缺省文件发送器、生产调用点全部注入、自动体消息带 origin=agent、人手发带 human、对话 MCP 白名单必带总机。

const dirs: string[] = [];
function tmp(prefix: string): string { const d = mkdtempSync(join(tmpdir(), prefix)); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function fakeSender() {
  const sent: NewMessageInput[] = [];
  return { sent, send: async (input: NewMessageInput) => { sent.push(input); } };
}

describe("总机接真实消费者（作者锁定）", () => {
  it("origin 随消息落盘并能读回；fileSwitchboardSender 写进文件邮箱", async () => {
    const msg = newMessage({ from: "a", to: "b", body: "x", origin: { kind: "human" } }, { now: () => 1, id: () => "m1" });
    expect(msg.origin).toEqual({ kind: "human" });
    expect(newMessage({ from: "a", to: "b", body: "x" }, { now: () => 1, id: () => "m2" })).not.toHaveProperty("origin");
    const dir = tmp("kp-sb-sender-");
    await fileSwitchboardSender(dir).send({ from: "dev-cycle", to: "all", body: "hi", kind: "failure", origin: { kind: "agent" } });
    const stored = await new SwitchboardStore(dir).list();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ from: "dev-cycle", kind: "failure", origin: { kind: "agent" }, read: false });
  });

  it("dev-cycle：流回滚时 failure 消息带 origin=agent", async () => {
    const repo = tmp("kp-sb-dc-");
    const git = simpleGit(repo);
    await git.init(); await git.addConfig("user.email", "t@t.t"); await git.addConfig("user.name", "t"); await git.checkoutLocalBranch("main");
    writeFileSync(join(repo, "README.md"), "base\n"); await git.add("."); await git.commit("init");
    const sb = fakeSender();
    // 回滚路径会往 stderr 打 [rollback] 之类的提示：全部接住，免得项目检查的基线差分把它当成新问题。
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const quietWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const quietLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const r = await new DevCycle({
      logger: createLogger({ sink: () => undefined }),
      store: new ArtifactStore(join(repo, ".kunpeng", "artifacts")), ws: new Workspace(repo), tracker: new FlowTracker(join(repo, ".kunpeng", "state")),
      runner: new FakeRunner({ spec: { text: "## acceptance\n- ok", meta: {}, backend: "claude" }, implement: { text: "done", meta: {}, backend: "claude" } }),
      flowId: "sb-flow-1", acceptanceCmd: "false", switchboard: sb,
    }).run("# 演示需求");
    quiet.mockRestore(); quietWarn.mockRestore(); quietLog.mockRestore();
    expect(r.status).toBe("rolled-back");
    const failure = sb.sent.find((m) => m.kind === "failure");
    expect(failure).toMatchObject({ from: "dev-cycle", to: "all", topic: "sb-flow-1", origin: { kind: "agent" } });
  });

  it("loop driver：门禁早退的 idle_notification 带 origin=agent", async () => {
    const root = tmp("kp-sb-loop-");
    const sb = fakeSender();
    const loop: LoopDef = { id: "sb-loop", name: "SB", projectId: "p", recipe: "geo-monitor", metric: { key: "m", label: "M", current: 1 },
      levers: [{ id: "ship", label: "Ship", status: "active" }], nextLever: { lever: "ship" }, waves: [], createdAt: 1, updatedAt: 1, autonomous: false };
    const out = await runLoopWave("sb-loop", { repoRoot: root, store: { read: async () => loop, appendWave: vi.fn() }, tracker: { start: vi.fn(async () => undefined), finish: vi.fn(async () => undefined) }, env: {}, now: () => 5, switchboard: sb });
    expect(out.gated).toBe(true);
    expect(sb.sent[0]).toMatchObject({ from: "loop-driver", kind: "idle_notification", origin: { kind: "agent" } });
  });

  it("对话 MCP：内置 switchboard-mcp = node <cli.js> switchboard-mcp；白名单必带且不重复", () => {
    const def = BUILTIN_MCP_SERVERS["switchboard-mcp"];
    expect(def.command).toBe(process.execPath);
    expect(def.args[0]).toMatch(/cli\.js$/);
    expect(def.args[1]).toBe("switchboard-mcp");
    expect(withSwitchboardMcp(["kunpeng-gw"])).toEqual(["kunpeng-gw", "switchboard-mcp"]);
    expect(withSwitchboardMcp(["switchboard-mcp", "xcrawl"])).toEqual(["switchboard-mcp", "xcrawl"]);
  });

  it("生产调用点全部注入缺省发送器；kunpeng send 标 human；对话白名单经 withSwitchboardMcp", () => {
    const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
    const count = (text: string, needle: string) => text.split(needle).length - 1;
    expect(count(src("../../src/plan/orchestrator.ts"), "switchboard: fileSwitchboardSender()")).toBe(1);
    expect(count(src("../../src/cli-commands/devcycle.ts"), "switchboard: fileSwitchboardSender()")).toBe(2);
    expect(count(src("../../src/sdk/kunpeng.ts"), "switchboard: fileSwitchboardSender()")).toBe(1);
    expect(count(src("../../src/server/workspace-driver-deps.ts"), "switchboard: fileSwitchboardSender()")).toBe(1);
    expect(count(src("../../src/cli-commands/loop-core.ts"), "switchboard: fileSwitchboardSender()")).toBe(2);
    expect(src("../../src/cli-commands/switchboard.ts")).toContain('origin: { kind: "human" }');
    expect(src("../../src/server/chat-stream.ts")).toContain("withSwitchboardMcp(chatMcpNames(");
  });
});