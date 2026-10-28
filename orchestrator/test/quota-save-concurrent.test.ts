import { expect, test, describe, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { QuotaTracker, saveQuota, loadQuota } from "../src/agent/quota-tracker.js";

// 复现真 bug：配了 accounts.json 后，并发流共享同一 tracker 写同一 quota.json，
// saveQuota 的 tmpPath 用 Date.now() 同毫秒碰撞 → rename ENOENT 崩。
describe("saveQuota 并发写同一路径", () => {
  let dir: string;
  let p: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "quota-save-"));
    p = path.join(dir, "quota.json");
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test("20 个并发 saveQuota 到同一路径不崩，最终文件是合法 JSON", async () => {
    const tracker = new QuotaTracker();
    const now = Date.now();
    tracker.record("a", "m", now);
    // 同一 tick 内大量并发——必触发 Date.now() 同毫秒碰撞场景
    await Promise.all(Array.from({ length: 20 }, () => saveQuota(p, tracker)));
    const restored = await loadQuota(p);
    expect(restored.usage().some((r) => r.account === "a")).toBe(true);
  });

  test("并发期间无残留 .tmp 文件", async () => {
    const tracker = new QuotaTracker();
    tracker.record("a", "m", Date.now());
    await Promise.all(Array.from({ length: 15 }, () => saveQuota(p, tracker)));
    const files = await fs.readdir(dir);
    expect(files.filter((f) => f.includes(".tmp")).length).toBe(0);
  });
});
