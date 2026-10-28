import { expect, test, describe, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { QuotaTracker } from "../src/agent/quota-tracker.js";
import { pickAccount, type Account } from "../src/agent/account-pool.js";
import { collectState } from "../src/server/state.js";
import { ArtifactStore } from "../src/artifacts/store.js";

// 这些测试走【真实生产串线】，不手搓 tracker 的全局 windowHours——
// 复现对抗审查抓到的 D1/D2/D5：评审发现单测都绕过了 cli.ts→state.ts 的真实装配。

const HOUR = 3_600_000;

describe("D1 · 滑动窗经 applyAccountConfig 接进生产（loadQuota 不带全局 windowHours）", () => {
  test("无全局 windowHours 时，按账号配置使 accountTotal 过窗归零", () => {
    // loadQuota 首次运行返回的就是这种 tracker：没有全局 windowHours
    const tracker = new QuotaTracker();
    tracker.applyAccountConfig([{ id: "a", windowHours: 5 }]);
    const t0 = 1_000_000;
    tracker.record("a", "haiku", t0);
    tracker.record("a", "haiku", t0);
    expect(tracker.accountTotal("a", t0)).toBe(2);
    // 过 5h 窗后该账号本窗清零
    expect(tracker.accountTotal("a", t0 + 5 * HOUR)).toBe(0);
  });

  test("pickAccount 过窗后恢复可用（修复前会被永久判定耗尽）", () => {
    const tracker = new QuotaTracker();
    tracker.applyAccountConfig([{ id: "a", windowHours: 5 }]);
    const accounts = [{ id: "a", limit: 1, windowHours: 5 }];
    const t0 = 1_000_000;
    tracker.record("a", "haiku", t0);
    expect(() => pickAccount(accounts, tracker, t0)).toThrow(/耗尽/);
    // 窗口重置后又能选中 a
    expect(pickAccount(accounts, tracker, t0 + 5 * HOUR)?.id).toBe("a");
  });

  test("每账号各自的 windowHours 互不影响", () => {
    const tracker = new QuotaTracker();
    tracker.applyAccountConfig([
      { id: "fast", windowHours: 1 },
      { id: "slow", windowHours: 10 },
    ]);
    const t0 = 1_000_000;
    tracker.record("fast", "m", t0);
    tracker.record("slow", "m", t0);
    const t = t0 + 2 * HOUR; // fast 已过窗、slow 未过
    expect(tracker.accountTotal("fast", t)).toBe(0);
    expect(tracker.accountTotal("slow", t)).toBe(1);
  });
});

describe("D2/D5 · 总控台从 KUNPENG_HOME 读全局配额（非 repoRoot）", () => {
  let home: string;
  let repo: string;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "kp-home-"));
    repo = await fs.mkdtemp(path.join(os.tmpdir(), "kp-repo-"));
    await fs.mkdir(path.join(home, ".kunpeng"), { recursive: true });
    await fs.mkdir(path.join(repo, ".kunpeng", "artifacts"), { recursive: true });
    await fs.mkdir(path.join(repo, ".kunpeng", "state"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(repo, { recursive: true, force: true });
  });

  async function seedHome(accounts: Account[], records: { account: string; model: string; n: number }[], windowHours?: number) {
    const tracker = new QuotaTracker();
    if (windowHours) tracker.applyAccountConfig(accounts.map((a) => ({ id: a.id, windowHours })));
    const now = Date.now();
    for (const r of records) for (let i = 0; i < r.n; i++) tracker.record(r.account, r.model, now);
    await fs.writeFile(path.join(home, ".kunpeng", "quota.json"), JSON.stringify(tracker.toJSON()), "utf8");
    await fs.writeFile(path.join(home, ".kunpeng", "accounts.json"), JSON.stringify(accounts), "utf8");
  }

  test("D2: quota/accounts 从 kunpengHome 读，repoRoot 没有也能渲染面板", async () => {
    // 文件只在 home，repoRoot 的 .kunpeng 里没有 quota.json/accounts.json
    await seedHome([{ id: "a", limit: 200, windowHours: 5 }], [{ account: "a", model: "haiku", n: 3 }], 5);
    const store = new ArtifactStore(path.join(repo, ".kunpeng", "artifacts"));
    const state = await collectState(store, repo, { kunpengHome: home });
    const acctA = state.quota?.accounts.find((x) => x.id === "a");
    expect(acctA).toBeDefined();
    expect(acctA?.used).toBe(3);
    expect(acctA?.limit).toBe(200);
    expect(acctA?.resetMs).toBeGreaterThan(0);
  });

  test("D3: used 取窗内 accountTotal（非终身 usage 之和）", async () => {
    // 持久化的记录已过窗：accountTotal 应为 0，而非原始 usage 累计
    const tracker = new QuotaTracker();
    tracker.applyAccountConfig([{ id: "a", windowHours: 1 }]);
    const t0 = Date.now() - 3 * HOUR; // 3 小时前，1h 窗早过期
    tracker.record("a", "haiku", t0);
    tracker.record("a", "haiku", t0);
    await fs.writeFile(path.join(home, ".kunpeng", "quota.json"), JSON.stringify(tracker.toJSON()), "utf8");
    await fs.writeFile(path.join(home, ".kunpeng", "accounts.json"), JSON.stringify([{ id: "a", limit: 200, windowHours: 1 }]), "utf8");
    const store = new ArtifactStore(path.join(repo, ".kunpeng", "artifacts"));
    const state = await collectState(store, repo, { kunpengHome: home });
    const acctA = state.quota?.accounts.find((x) => x.id === "a");
    expect(acctA?.used).toBe(0); // 过窗归零，不是 2
  });

  test("D5: 超限把健康灯从绿提到黄（不直接拉红）", async () => {
    await seedHome([{ id: "a", limit: 1, windowHours: 5 }], [{ account: "a", model: "haiku", n: 3 }], 5);
    const store = new ArtifactStore(path.join(repo, ".kunpeng", "artifacts"));
    const state = await collectState(store, repo, { kunpengHome: home });
    expect(state.systemLight).toBe("yellow");
  });

  test("零配置兜底：home 无 quota.json → 不渲染面板", async () => {
    const store = new ArtifactStore(path.join(repo, ".kunpeng", "artifacts"));
    const state = await collectState(store, repo, { kunpengHome: home });
    expect(state.quota).toBeUndefined();
  });
});
