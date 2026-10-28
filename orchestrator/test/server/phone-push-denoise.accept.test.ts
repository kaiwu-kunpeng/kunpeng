// 2026-09-28 用户反馈「推送太多，重要的再推」：手机只推需要人出手的事。作者锁定。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { awaitGateWatchIdle, ensureVapidKeys, startGateWatch } from "../../src/server/push.js";

const MIN = 60_000;
let home: string;
let stateDir: string;
let repo: string;
let wxBodies: string[];

function tracker(clock: () => number): FlowTracker {
  return new FlowTracker(join(repo, ".kunpeng", "state"), clock);
}

async function seedMergeGate(flowId: string, openedMinutesAgo: number): Promise<void> {
  const t = tracker(() => Date.now() - openedMinutesAgo * MIN);
  await t.start(flowId, "demo requirement");
  await t.finish(flowId, "verified", { gate: "合并主干 (人工门#1)", what: `kp/${flowId} → main` });
}

async function seedStuck(flowId: string, minutesAgo: number): Promise<void> {
  await tracker(() => Date.now() - minutesAgo * MIN).start(flowId, "demo requirement");
}

async function seedLongRunning(flowId: string): Promise<void> {
  let now = Date.now() - 45 * MIN;
  const t = tracker(() => now);
  await t.start(flowId, "demo requirement");
  now = Date.now();
  await t.setResumeAttempts(flowId, 0);
}

function writeNotifyConfig(): void {
  writeFileSync(join(stateDir, "notify.json"), JSON.stringify({ wxpusher: { appToken: "AT_demo", uid: "UID_demo" } }));
}

function writeLastPush(minutesAgo: number): void {
  mkdirSync(join(stateDir, "push"), { recursive: true });
  writeFileSync(join(stateDir, "push", "phone-last.json"), JSON.stringify({ at: Date.now() - minutesAgo * MIN }));
}

async function scanOnce(): Promise<void> {
  const stop = startGateWatch(60000);
  await awaitGateWatchIdle();
  await stop();
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "kp-pp-home-"));
  stateDir = join(home, ".kunpeng");
  mkdirSync(stateDir, { recursive: true });
  repo = mkdtempSync(join(tmpdir(), "kp-pp-repo-"));
  writeFileSync(join(stateDir, "projects.json"), JSON.stringify({ projects: [{ id: "demo-proj", name: "Demo", repoPath: repo, registeredAt: 1 }] }));
  vi.stubEnv("HOME", home);
  wxBodies = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string }) => {
    if (String(url).includes("wxpusher")) wxBodies.push(String(init?.body ?? ""));
    return { ok: true, status: 200, json: async () => ({ success: true, code: 1000 }) };
  }));
  await ensureVapidKeys(stateDir);
  writeNotifyConfig();
});

afterEach(async () => {
  await awaitGateWatchIdle().catch(() => undefined);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe("手机推送只推需要人出手的事（作者锁定）", () => {
  it("流 verified 开出合并门的那一刻不推手机", async () => {
    await seedMergeGate("pp-fresh-finish", 0);
    await new Promise((r) => setTimeout(r, 100));
    expect(wxBodies.length).toBe(0);
  });

  it("合并门才开 10 分钟：扫描不推", async () => {
    await seedMergeGate("pp-merge-young", 10);
    await scanOnce();
    expect(wxBodies.length).toBe(0);
  });

  it("合并门已开 90 分钟：扫描推一条，正文带 flowId", async () => {
    await seedMergeGate("pp-merge-old", 90);
    await scanOnce();
    expect(wxBodies.length).toBe(1);
    expect(wxBodies[0]).toContain("pp-merge-old");
  });

  it("长跑告警不推", async () => {
    await seedLongRunning("pp-long-run");
    await scanOnce();
    expect(wxBodies.length).toBe(0);
  });

  it("卡死 15 分钟不推（自建流单步就可能这么久）", async () => {
    await seedStuck("pp-stuck-15", 15);
    await scanOnce();
    expect(wxBodies.length).toBe(0);
  });

  it("同一轮里两件事合成一条推送", async () => {
    await seedMergeGate("pp-digest-merge", 120);
    await seedStuck("pp-digest-stuck", 60);
    await scanOnce();
    expect(wxBodies.length).toBe(1);
    expect(wxBodies[0]).toContain("pp-digest-merge");
    expect(wxBodies[0]).toContain("pp-digest-stuck");
  });

  it("30 分钟内推过：本轮不推，候选留到窗口过后再推", async () => {
    writeLastPush(5);
    await seedStuck("pp-throttled", 60);
    await scanOnce();
    expect(wxBodies.length).toBe(0);
    writeLastPush(31);
    await scanOnce();
    expect(wxBodies.length).toBe(1);
    expect(wxBodies[0]).toContain("pp-throttled");
  });

  it("推过的不重推：窗口过后再扫也不重复", async () => {
    await seedStuck("pp-once", 60);
    await scanOnce();
    expect(wxBodies.length).toBe(1);
    writeLastPush(31);
    await scanOnce();
    expect(wxBodies.length).toBe(1);
  });
});