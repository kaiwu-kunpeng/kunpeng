import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { awaitGateWatchIdle, drainPending, ensureVapidKeys, notify, pushQueueDropped, startGateWatch } from "../../src/server/push.js";

let home: string;
let stateDir: string;
let repo: string;
let wxBodies: string[];
const stoppers: Array<() => Promise<void>> = [];

async function seedStuckFlow(flowId: string): Promise<void> {
  const tracker = new FlowTracker(join(repo, ".kunpeng", "state"), () => Date.now() - 3_600_000);
  await tracker.start(flowId, "demo requirement");
}

function writeNotifyConfig(): void {
  writeFileSync(join(stateDir, "notify.json"), JSON.stringify({ wxpusher: { appToken: "AT_demo", uid: "UID_demo" } }));
}

async function scanOnce(): Promise<void> {
  const stop = startGateWatch(60000);
  await awaitGateWatchIdle();
  await stop();
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "kp-wd-home-"));
  stateDir = join(home, ".kunpeng");
  mkdirSync(stateDir, { recursive: true });
  repo = mkdtempSync(join(tmpdir(), "kp-wd-repo-"));
  writeFileSync(join(stateDir, "projects.json"), JSON.stringify({ projects: [{ id: "demo-proj", name: "Demo", repoPath: repo, registeredAt: 1 }] }));
  vi.stubEnv("HOME", home);
  wxBodies = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string }) => {
    if (String(url).includes("wxpusher")) wxBodies.push(String(init?.body ?? ""));
    return { ok: true, status: 200, json: async () => ({ success: true, code: 1000 }) };
  }));
  await ensureVapidKeys(stateDir);
});

afterEach(async () => {
  for (const stop of stoppers.splice(0)) await stop().catch(() => undefined);
  await awaitGateWatchIdle().catch(() => undefined);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe("看门狗告警走 notify 通道推到手机（作者锁定）", () => {
  it("卡死流被扫到 → 经 WxPusher 推一条，正文带 flowId", async () => {
    writeNotifyConfig();
    await seedStuckFlow("wd-stuck-flow-a");
    await scanOnce();
    expect(wxBodies.length).toBe(1);
    expect(wxBodies[0]).toContain("wd-stuck-flow-a");
  });

  it("同一告警只推一次：服务重启（重新开扫）后不重推", async () => {
    writeNotifyConfig();
    await seedStuckFlow("wd-stuck-flow-b");
    await scanOnce();
    await scanOnce();
    expect(wxBodies.length).toBe(1);
  });

  it("没配 notify.json → 扫描照常完成，不发任何推送", async () => {
    await seedStuckFlow("wd-stuck-flow-c");
    await scanOnce();
    expect(wxBodies.length).toBe(0);
  });

  it("推送抛错 → 只 warn，不影响扫描（web-push 队列照样入队）", async () => {
    writeNotifyConfig();
    await seedStuckFlow("wd-stuck-flow-d");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await scanOnce();
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    const pending = await drainPending();
    expect(pending.some((n) => String(n.title).includes("wd-stuck-flow-d"))).toBe(true);
  });
});

describe("web-push 待取队列溢出可观察（作者锁定）", () => {
  it("超过 20 条：保留最近 20 条，丢弃数计入 pushQueueDropped 并 warn", async () => {
    await drainPending();
    const before = pushQueueDropped();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (let i = 0; i < 23; i += 1) await notify({ kind: "done", title: `t${i}`, body: "b", url: "/" });
    const drained = await drainPending();
    expect(drained.length).toBe(20);
    expect(drained[19]!.title).toBe("t22");
    expect(pushQueueDropped() - before).toBe(3);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("丢弃"))).toBe(true);
  });
});