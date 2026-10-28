import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { startDashboard } from "../../src/server/http.js";
import { startPresenceHeartbeat, type PresenceMeta } from "../../src/switchboard/presence-heartbeat.js";

// 背景（2026-10-03 通讯审计 A2 S2 / 总报告 P0-7）：presence 只在 CLI 启动与 SessionStart hook 时写一次，
// 60s 窗口下 230 个 presence 文件、在线 = []。本测试锁定仓内三处长活心跳：
//   serve 自身 ≤30s 一次（close 后不再写）；dev-cycle 每个 agent 阶段期间 `flow:<flowId>`；ops loop 波次期间 `loop:<loopId>`。

type Beat = { instance: string; ts: number; meta: PresenceMeta };
function fakePresence(fail = false): { beats: Beat[]; beat: (instance: string, ts: number, meta?: PresenceMeta) => Promise<void> } {
  const beats: Beat[] = [];
  return {
    beats,
    beat: async (instance, ts, meta = {}) => {
      if (fail) throw new Error("disk full");
      beats.push({ instance, ts, meta });
    },
  };
}

const dirs: string[] = [];
function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("presence 长活心跳（作者锁定）", () => {
  it("startPresenceHeartbeat：立刻打一次，按间隔续打，stop 后不再打；写失败不影响后续", async () => {
    vi.useFakeTimers();
    const presence = fakePresence();
    let t = 1000;
    const hb = startPresenceHeartbeat({ presence, instance: "x", meta: { task: "t" }, intervalMs: 100, now: () => t });
    expect(presence.beats.map((b) => b.ts)).toEqual([1000]);
    t = 1100; await vi.advanceTimersByTimeAsync(100);
    t = 1200; await vi.advanceTimersByTimeAsync(100);
    expect(presence.beats.map((b) => b.ts)).toEqual([1000, 1100, 1200]);
    expect(presence.beats[0]).toEqual({ instance: "x", ts: 1000, meta: { task: "t" } });
    await hb.stop();
    t = 1300; await vi.advanceTimersByTimeAsync(500);
    expect(presence.beats).toHaveLength(3);

    const failing = fakePresence(true);
    const hb2 = startPresenceHeartbeat({ presence: failing, instance: "y", intervalMs: 50 });
    await vi.advanceTimersByTimeAsync(120);
    await expect(hb2.stop()).resolves.toBeUndefined();
  });

  it("serve：起来就给自己的 presence 打心跳（KUNPENG_INSTANCE 为实例名），close 之后不再写", async () => {
    const prevInstance = process.env.KUNPENG_INSTANCE;
    process.env.KUNPENG_INSTANCE = "serve-under-test";
    const stateDir = tmp("kp-presence-serve-");
    const file = join(stateDir, "presence", "serve-under-test.json");
    const server = await startDashboard({ port: 0, stateDir, execPath: "/usr/bin/false", cliJs: "/nonexistent/cli.js", presenceIntervalMs: 40 });
    try {
      const until = Date.now() + 3000;
      while (Date.now() < until && !existsSync(file)) await new Promise((r) => setTimeout(r, 20));
      expect(existsSync(file)).toBe(true);
      const first = JSON.parse(readFileSync(file, "utf8")) as { instance: string; ts: number; task?: string };
      expect(first.instance).toBe("serve-under-test");
      expect(first.task).toContain("kunpeng serve");
      await new Promise((r) => setTimeout(r, 120));
      const second = JSON.parse(readFileSync(file, "utf8")) as { ts: number };
      expect(second.ts).toBeGreaterThan(first.ts);
    } finally {
      await server.close();
      if (prevInstance === undefined) delete process.env.KUNPENG_INSTANCE;
      else process.env.KUNPENG_INSTANCE = prevInstance;
    }
    const afterClose = readFileSync(file, "utf8");
    await new Promise((r) => setTimeout(r, 150));
    expect(readFileSync(file, "utf8")).toBe(afterClose);
  });

  it("dev-cycle：spec / implement 阶段期间以 flow:<flowId> 心跳，meta 带 worktree 与 stage", async () => {
    const repo = tmp("kp-presence-dc-");
    const git = simpleGit(repo);
    await git.init();
    await git.addConfig("user.email", "t@t.t");
    await git.addConfig("user.name", "t");
    await git.checkoutLocalBranch("main");
    writeFileSync(join(repo, "README.md"), "base\n");
    await git.add(".");
    await git.commit("init");
    const presence = fakePresence();
    const flowId = "presence-flow-1";
    const r = await new DevCycle({
      store: new ArtifactStore(join(repo, ".kunpeng", "artifacts")),
      ws: new Workspace(repo),
      tracker: new FlowTracker(join(repo, ".kunpeng", "state")),
      runner: new FakeRunner({ spec: { text: "## acceptance\n- ok", meta: {}, backend: "claude" }, implement: { text: "done", meta: {}, backend: "claude" } }),
      flowId,
      acceptanceCmd: "grep -q base README.md",
      presence,
    }).run("# 演示需求");
    expect(r.status).toBe("verified");
    const stages = new Set(presence.beats.map((b) => b.meta.task));
    expect(stages.has("spec")).toBe(true);
    expect(stages.has("implement")).toBe(true);
    for (const b of presence.beats) {
      expect(b.instance).toBe(`flow:${flowId}`);
      expect(b.meta.worktree ?? "").toContain(flowId);
    }
  });

  it("ops loop：波次期间以 loop:<loopId> 心跳，门禁早退路径也打", async () => {
    const root = tmp("kp-presence-loop-");
    execFileSync("git", ["init", "--quiet", root]);
    const presence = fakePresence();
    const loop: LoopDef = {
      id: "hb-loop", name: "HB Loop", projectId: "hb-project", recipe: "geo-monitor",
      metric: { key: "m", label: "M", current: 10 },
      levers: [{ id: "ship", label: "Ship", status: "active" }],
      nextLever: { lever: "ship", target: "TARGET-A" },
      waves: [], createdAt: 1, updatedAt: 1, autonomous: false,
    };
    const finish = vi.fn(async () => undefined);
    const out = await runLoopWave("hb-loop", {
      repoRoot: root,
      store: { read: async () => loop, appendWave: vi.fn() },
      tracker: { start: vi.fn(async () => undefined), finish },
      env: {},
      now: () => 4242,
      presence,
    });
    expect(out.gated).toBe(true);
    expect(presence.beats.length).toBeGreaterThanOrEqual(1);
    expect(presence.beats[0]).toMatchObject({ instance: "loop:hb-loop", ts: 4242, meta: { task: "ops loop wave", worktree: root } });
  });

  it("接线守卫：serve / dev-cycle / loop driver 三处都接了心跳，缺省走 defaultPresenceBeater", () => {
    const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
    expect(read("../../src/server/http.ts")).toContain("startPresenceHeartbeat(");
    expect(read("../../src/loop/dev-cycle.ts")).toContain("defaultPresenceBeater()");
    expect(read("../../src/loop/driver.ts")).toContain("defaultPresenceBeater()");
  });
});