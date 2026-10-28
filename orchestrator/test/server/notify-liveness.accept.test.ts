import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { awaitGateWatchIdle, ensureVapidKeys, startGateWatch, CHANNEL_HEARTBEAT_MS, type ChannelHeartbeatRecord, type PhoneScanRecord } from "../../src/server/push.js";
import { buildStatusContext } from "../../src/status/build-context.js";
import { collectModuleStatus } from "../../src/status/collect-module-status.js";
import { MODULE_REGISTRY } from "../../src/status/module-registry.js";

// 背景（2026-10-03 通讯审计 A2 S1 第 2、3 条，总报告 P0-4）：手机通知链路自 09-28 起零送达证据且无法自证——
// 「三天没事」和「通道坏了」在系统里长得一样；Telegram 直批按钮（notifyMergeGate）无生产调用方，webhook 永远收不到回调。
// 本测试锁定：每轮扫描落 push/phone-scan.json；每日通道心跳（首轮只落种子、满 24h 才发）；新合并门对 Telegram 发带按钮的消息；
// `kunpeng status` 多一盏「手机通知」灯。

const MIN = 60_000;
let home: string;
let stateDir: string;
let repo: string;
let bodies: Array<{ url: string; body: string }>;
let fetchOk = true;
let warnings: string[];

function tracker(clock: () => number): FlowTracker {
  return new FlowTracker(join(repo, ".kunpeng", "state"), clock);
}

async function seedMergeGate(flowId: string, openedMinutesAgo: number): Promise<void> {
  const t = tracker(() => Date.now() - openedMinutesAgo * MIN);
  await t.start(flowId, "demo requirement");
  await t.finish(flowId, "verified", { gate: "合并主干 (人工门#1)", what: `kp/${flowId} → main` });
}

function writeNotifyConfig(extra: Record<string, unknown> = {}): void {
  writeFileSync(join(stateDir, "notify.json"), JSON.stringify({ wxpusher: { appToken: "AT_demo", uid: "UID_demo" }, ...extra }));
}

async function scanOnce(): Promise<void> {
  const stop = startGateWatch(60000);
  await awaitGateWatchIdle();
  await stop();
}

function readScan(): PhoneScanRecord {
  return JSON.parse(readFileSync(join(stateDir, "push", "phone-scan.json"), "utf8")) as PhoneScanRecord;
}
function readHeartbeat(): ChannelHeartbeatRecord {
  return JSON.parse(readFileSync(join(stateDir, "push", "channel-heartbeat.json"), "utf8")) as ChannelHeartbeatRecord;
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "kp-nl-home-"));
  stateDir = join(home, ".kunpeng");
  mkdirSync(stateDir, { recursive: true });
  repo = mkdtempSync(join(tmpdir(), "kp-nl-repo-"));
  writeFileSync(join(stateDir, "projects.json"), JSON.stringify({ projects: [{ id: "demo-proj", name: "Demo", repoPath: repo, registeredAt: 1 }] }));
  vi.stubEnv("HOME", home);
  bodies = [];
  fetchOk = true;
  // 预期内的「推送失败」告警全部接住：既断言它发生了，也不让它落到 stderr 被项目检查当成基线外新问题。
  warnings = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => { warnings.push(args.map(String).join(" ")); });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string }) => {
    bodies.push({ url: String(url), body: String(init?.body ?? "") });
    if (!fetchOk) return { ok: false, status: 500, json: async () => ({ success: false }) };
    return { ok: true, status: 200, json: async () => ({ success: true, code: 1000, ok: true }) };
  }));
  await ensureVapidKeys(stateDir);
});

afterEach(async () => {
  await awaitGateWatchIdle().catch(() => undefined);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe("通知通道活性可观测（作者锁定）", () => {
  it("每轮扫描落 phone-scan.json：无候选记 no-candidates", async () => {
    writeNotifyConfig();
    await scanOnce();
    expect(readScan()).toMatchObject({ candidates: 0, sent: [], failed: [], skipped: "no-candidates" });
    expect(bodies.length).toBe(0);
  });

  it("有候选且推成功：记 candidates ≥1、sent=[wxpusher]、failed=[]，并落 phone-last.json", async () => {
    writeNotifyConfig();
    await seedMergeGate("nl-merge-old", 90);
    await scanOnce();
    const ok = readScan();
    expect(ok.candidates).toBeGreaterThanOrEqual(1);
    expect(ok.sent).toEqual(["wxpusher"]);
    expect(ok.failed).toEqual([]);
    expect(ok.skipped).toBeUndefined();
    expect(existsSync(join(stateDir, "push", "phone-last.json"))).toBe(true);
  });

  it("有候选但通道全败：记 sent=[]、failed=[wxpusher]（「没事发生」和「通道坏了」从此分得开）", async () => {
    writeNotifyConfig();
    fetchOk = false;
    await seedMergeGate("nl-merge-fail", 120);
    await scanOnce();
    const bad = readScan();
    expect(bad.candidates).toBeGreaterThanOrEqual(1);
    expect(bad.sent).toEqual([]);
    expect(bad.failed).toEqual(["wxpusher"]);
    expect(existsSync(join(stateDir, "push", "phone-last.json"))).toBe(false);
    expect(warnings.some((w) => w.includes("wxpusher") && w.includes("推送失败"))).toBe(true);
  });

  it("没配置通知通道：有候选也记 no-config，不发任何请求", async () => {
    await seedMergeGate("nl-noconf", 90);
    await scanOnce();
    expect(readScan()).toMatchObject({ skipped: "no-config", sent: [], failed: [] });
    expect(bodies.length).toBe(0);
    expect(existsSync(join(stateDir, "push", "channel-heartbeat.json"))).toBe(false);
  });

  it("每日通道心跳：首轮只落种子不发；种子满 24h 后真发一条并记结果", async () => {
    writeNotifyConfig();
    await scanOnce();
    expect(readHeartbeat()).toMatchObject({ seeded: true, sent: [], failed: [] });
    expect(bodies.length).toBe(0);

    writeFileSync(join(stateDir, "push", "channel-heartbeat.json"), JSON.stringify({ at: Date.now() - CHANNEL_HEARTBEAT_MS - MIN, sent: [], failed: [] }));
    await scanOnce();
    const hb = readHeartbeat();
    expect(hb.seeded).toBeUndefined();
    expect(hb.sent).toEqual(["wxpusher"]);
    expect(bodies.some((b) => b.url.includes("wxpusher") && b.body.includes("通知通道心跳"))).toBe(true);

    await scanOnce();
    expect(bodies.filter((b) => b.body.includes("通知通道心跳")).length).toBe(1);
  });

  it("新合并门 + Telegram 已配置：只对 Telegram 发带 kpapprove 按钮的消息，WxPusher 不重复收按钮消息", async () => {
    writeNotifyConfig({ telegram: { token: "T0K", chatId: "42" }, cockpitUrl: "https://cockpit.example" });
    await seedMergeGate("nl-tg-gate", 0);
    await scanOnce();
    const tg = bodies.filter((b) => b.url.includes("api.telegram.org"));
    expect(tg.length).toBe(1);
    expect(tg[0]!.body).toContain("kpapprove:nl-tg-gate");
    expect(tg[0]!.body).toContain("kpreject:nl-tg-gate");
    expect(bodies.filter((b) => b.url.includes("wxpusher")).length).toBe(0);
    expect(readScan().buttons).toEqual({ sent: ["telegram"], failed: [] });

    await scanOnce();
    expect(bodies.filter((b) => b.url.includes("api.telegram.org")).length).toBe(1);
  });

  it("kunpeng status 多一盏「手机通知」灯：未配置红、推送全败红、近期成功绿；模块数 20", async () => {
    expect(MODULE_REGISTRY.length).toBe(20);
    expect(MODULE_REGISTRY.find((m) => m.id === "notify")?.category).toBe("comms");
    const repoRoot = mkdtempSync(join(tmpdir(), "kp-nl-status-repo-"));
    mkdirSync(join(repoRoot, ".kunpeng"), { recursive: true });
    const now = Date.now();
    const truths = { flows: [], health: { alerts: [], running: 0, healthy: 1 }, branches: [] as string[] };
    const light = async () => {
      const ctx = await buildStatusContext({ repoRoot, stateDir, now, truths });
      return collectModuleStatus(ctx).modules.find((m) => m.id === "notify")!;
    };
    rmSync(join(stateDir, "notify.json"), { force: true });
    let m = await light();
    expect(m.light).toBe("red");
    expect(m.note).toContain("未配置");

    writeNotifyConfig();
    mkdirSync(join(stateDir, "push"), { recursive: true });
    writeFileSync(join(stateDir, "push", "phone-scan.json"), JSON.stringify({ at: now - MIN, candidates: 2, sent: [], failed: ["wxpusher"] }));
    m = await light();
    expect(m.light).toBe("red");
    expect(m.lastActivity?.ok).toBe(false);

    writeFileSync(join(stateDir, "push", "phone-scan.json"), JSON.stringify({ at: now - MIN, candidates: 2, sent: ["wxpusher"], failed: [] }));
    writeFileSync(join(stateDir, "push", "phone-last.json"), JSON.stringify({ at: now - MIN }));
    m = await light();
    expect(m.light).toBe("green");
    expect(m.lastActivity?.summary).toContain("wxpusher");
    rmSync(repoRoot, { recursive: true, force: true });
  });
});