import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliRunner } from "../../src/agent/cli-runner.js";
import { FakeRunner } from "../../src/agent/runner.js";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { Workspace } from "../../src/git/workspace.js";
import { DevCycle } from "../../src/loop/dev-cycle.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { createLogger } from "../../src/runtime/logger.js";

// 背景（2026-10-03 审计总报告 P1-11；记忆里两条旧伤）：槽位满等 30 分钟超时后进程直接退出、不建状态文件，看板上像没派过；
// 同 flowId 撞车（写锁已被持有）混在"dev-cycle 异常"里无归因；后端全不可用只剩一句"均不可用"，不知是没检测到还是被标坏。
// 本测试锁定：三类派流/后端失败都落成可见、可归因的状态。

let repo: string;
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-dispatch-vis-"));
  const git = simpleGit(repo);
  await git.init(); await git.addConfig("user.email", "t@t.t"); await git.addConfig("user.name", "t"); await git.checkoutLocalBranch("main");
  writeFileSync(join(repo, "README.md"), "base\n"); await git.add("."); await git.commit("init");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); rmSync(repo, { recursive: true, force: true }); });

function deps(flowId: string, extra: Record<string, unknown> = {}) {
  return {
    store: new ArtifactStore(join(repo, ".kunpeng", "artifacts")),
    ws: new Workspace(repo),
    tracker: new FlowTracker(join(repo, ".kunpeng", "state")),
    runner: new FakeRunner({ spec: { text: "## acceptance\n- ok", meta: {}, backend: "claude" }, implement: { text: "done", meta: {}, backend: "claude" } }),
    flowId,
    acceptanceCmd: "grep -q base README.md",
    logger: createLogger({ sink: () => undefined }),
    ...extra,
  };
}

describe("派流失败可见（作者锁定）", () => {
  it("槽位等待超时：run 不再抛出，而是落一条 rolled-back 状态，原因带 [dispatch-slot-timeout]", async () => {
    const acquireSlot = vi.fn(async () => { throw new Error("并发上限 4：等待 1800000ms 未获得流槽位"); });
    const r = await new DevCycle(deps("slot-flow", { acquireSlot })).run("# 需求");
    expect(r.status).toBe("rolled-back");
    const state = await new FlowTracker(join(repo, ".kunpeng", "state")).read("slot-flow");
    expect(state?.status).toBe("rolled-back");
    expect(state?.failureReason).toContain("[dispatch-slot-timeout]");
    expect(state?.failureReason).toContain("未获得流槽位");
  });

  it("写锁撞车：同 flowId 的锁已被别的 Workspace 持有 → rolled-back，原因以 [dispatch-lock-conflict] 开头", async () => {
    const other = new Workspace(repo);
    await other.acquire("lock-flow");
    try {
      // 既有语义：dev-cycle 记完状态会把原异常照常抛出（rollback-transition-warn 锁定）；本流只改归因前缀，不改抛出行为。
      await expect(new DevCycle(deps("lock-flow")).run("# 需求")).rejects.toThrow(/write lock already held/);
      const state = await new FlowTracker(join(repo, ".kunpeng", "state")).read("lock-flow");
      expect(state?.failureReason?.startsWith("[dispatch-lock-conflict]")).toBe(true);
      expect(state?.failureReason).toContain("write lock already held");
    } finally {
      await other.rollback("lock-flow").catch(() => undefined);
    }
  });

  it("其它异常仍归 dev-cycle 异常（既有归因不变）", async () => {
    const runner = { backend: "claude", run: async () => { throw new Error("boom"); } } as unknown as FakeRunner;
    await expect(new DevCycle(deps("boom-flow", { runner })).run("# 需求")).rejects.toThrow("boom");
    const state = await new FlowTracker(join(repo, ".kunpeng", "state")).read("boom-flow");
    expect(state?.status).toBe("rolled-back");
    expect(state?.failureReason?.startsWith("dev-cycle 异常: ")).toBe(true);
  });

  it("后端全不可用：报错带 [backend-down]、已检测/已标不可用清单，且保留既有「均不可用」原句", async () => {
    const runner = new CliRunner({ availableBackends: new Set(), exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }) });
    const err = await runner.run({ stage: "implement", system: "", input: "x", tools: [], cwd: repo }).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).toContain("无可用后端（codex/claude 均不可用）");
    expect(String((err as Error).message)).toContain("[backend-down]");
    expect(String((err as Error).message)).toContain("已检测 -");
    expect(String((err as Error).message)).toContain("已标不可用 -");
  });
});