import { expect, test, describe, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { QuotaTracker, saveQuota, loadQuota } from "../src/agent/quota-tracker.js";

describe("quota delta 合并", () => {
  let dir: string; let p: string;
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), "quota-merge-")); p = path.join(dir, "quota.json"); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  test("两个独立 tracker 各 +1,不丢增量(12 而非 11)", async () => {
    // 盘上初始 base 10
    const base = new QuotaTracker();
    for (let i = 0; i < 10; i++) base.record("a", "m");
    await saveQuota(p, base);
    // 模拟两进程/两请求各自 loadQuota 到 {10},各 +1
    const t1 = await loadQuota(p); t1.record("a", "m");
    const t2 = await loadQuota(p); t2.record("a", "m");
    await saveQuota(p, t1);
    await saveQuota(p, t2);
    const final = await loadQuota(p);
    const rec = final.usage().find((r) => r.account === "a" && r.model === "m");
    expect(rec?.calls).toBe(12);
  });

  test("同一 tracker 并发保存 20 次不重复叠加(calls===1)", async () => {
    const t = new QuotaTracker();
    t.record("a", "m");
    await Promise.all(Array.from({ length: 20 }, () => saveQuota(p, t)));
    const final = await loadQuota(p);
    const rec = final.usage().find((r) => r.account === "a" && r.model === "m");
    expect(rec?.calls).toBe(1);
  });
});