import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { reconcileDeadFlows } from "../../src/runtime/reconcile.js";

const MIN = 60_000;
let dir: string;
let clock = 1_000_000;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-three-level-")); clock = 1_000_000; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function patch(flowId: string, fields: Record<string, unknown>): void {
  const path = join(dir, `${flowId}.json`);
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), ...fields }));
}

describe("判死三级（作者锁定）", () => {
  it("一次 >5 分钟无输出的工具调用不会被判死；2×ttl 后先 stall；再过一个 ttl 才判死并只杀 agent 进程组", async () => {
    const t = new FlowTracker(dir, () => clock);
    await t.start("f", "长工具调用");
    patch("f", { pid: 20, host: os.hostname() });
    await t.renewLease("f", 15 * MIN);
    await t.setAgentPid("f", 777);
    const killed: [number, string][] = [];
    const run = (now: number) => reconcileDeadFlows(t, { isAlive: () => true, now: () => now, kill: (pid, sig) => { killed.push([pid, sig]); } });

    expect((await run(clock + 6 * MIN)).reconciled).toEqual([]);
    expect((await t.read("f"))!.status).toBe("running");
    expect((await t.read("f"))!.stall).toBeUndefined();

    expect((await run(clock + 31 * MIN)).reconciled).toEqual([]);
    const stalled = (await t.read("f"))!;
    expect(stalled.status).toBe("running");
    expect(stalled.stall).toMatchObject({ detectedAt: clock + 31 * MIN, leaseAgeMs: 31 * MIN });
    expect(stalled.history.at(-1)).toEqual({ stage: "stalled", at: clock + 31 * MIN });
    expect(killed).toEqual([]);

    expect((await run(clock + 40 * MIN)).reconciled).toEqual([]);
    expect((await t.read("f"))!.status).toBe("running");

    expect((await run(clock + 47 * MIN)).reconciled).toEqual(["f"]);
    const dead = (await t.read("f"))!;
    expect(dead.status).toBe("crashed");
    expect(dead.failureReason).toContain("lease-expired-stuck");
    expect(dead.blocker).toContain("lease-expired-stuck");
    expect(dead.agentPid).toBeUndefined();
    expect(killed).toEqual([[777, "SIGKILL"]]);
  });

  it("心跳回来即解除 stall", async () => {
    const t = new FlowTracker(dir, () => clock);
    await t.start("g", "恢复的流");
    patch("g", { pid: 20, host: os.hostname() });
    await t.renewLease("g", 1000);
    await reconcileDeadFlows(t, { isAlive: () => true, now: () => clock + 5000, kill: () => {} });
    expect((await t.read("g"))!.stall).toBeDefined();
    clock += 6000;
    await t.renewLease("g", 1000);
    expect((await t.read("g"))!.stall).toBeUndefined();
    expect((await reconcileDeadFlows(t, { isAlive: () => true, now: () => clock + 1000, kill: () => {} })).reconciled).toEqual([]);
  });

  it("租约过期且主进程已死 → 立即判死（一级），杀掉还活着的 agent 进程组，failureReason=lease-expired", async () => {
    const t = new FlowTracker(dir, () => clock);
    await t.start("h", "主进程死了");
    patch("h", { pid: 20, host: os.hostname() });
    await t.renewLease("h", 1000);
    await t.setAgentPid("h", 888);
    const killed: number[] = [];
    const out = await reconcileDeadFlows(t, { isAlive: (pid) => pid === 888, now: () => clock + 10_000, kill: (pid) => { killed.push(pid); } });
    expect(out.reconciled).toEqual(["h"]);
    const s = (await t.read("h"))!;
    expect(s.status).toBe("crashed");
    expect(s.failureReason).toBe("lease-expired");
    expect(killed).toEqual([888]);
  });

  it("没有租约：维持旧逻辑，且 markCrashed 也写 failureReason", async () => {
    const t = new FlowTracker(dir, () => clock);
    await t.start("legacy-dead", "无心跳旧流");
    await t.start("legacy-alive", "无心跳活流");
    patch("legacy-dead", { pid: 10, host: os.hostname() });
    patch("legacy-alive", { pid: 20, host: os.hostname() });
    const out = await reconcileDeadFlows(t, { isAlive: (pid) => pid === 20, now: () => clock, kill: () => {} });
    expect(out.reconciled).toEqual(["legacy-dead"]);
    expect((await t.read("legacy-dead"))!.failureReason).toBe("主人进程已崩溃（启动时判定）");
    expect((await t.read("legacy-alive"))!.status).toBe("running");
  });
});