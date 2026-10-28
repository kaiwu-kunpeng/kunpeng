import { expect, test } from "vitest";
import { QuotaTracker, loadQuota, saveQuota } from "../src/agent/quota-tracker.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

test("toJSON serializes tracker state", () => {
  const t = new QuotaTracker({ windowHours: 24 });
  const now = 1000000;

  t.record("acct-a", "haiku", now);
  t.record("acct-a", "opus", now + 100);

  const state = t.toJSON();

  expect(state.schema).toBe("kunpeng-quota/v1");
  expect(state.records).toHaveLength(2);
  // All records for same account share the same windowStart
  expect(state.records[0]).toEqual({
    account: "acct-a",
    model: "haiku",
    calls: 1,
    windowStart: now,
  });
  expect(state.records[1]).toEqual({
    account: "acct-a",
    model: "opus",
    calls: 1,
    windowStart: now,
  });
});

test("fromJSON reconstructs tracker state", () => {
  const state = {
    schema: "kunpeng-quota/v1" as const,
    records: [
      { account: "acct-a", model: "haiku", calls: 5, windowStart: 1000000 },
      { account: "acct-b", model: "opus", calls: 3, windowStart: 1000100 },
    ],
  };

  const t = QuotaTracker.fromJSON(state);
  const now = 2000000;

  expect(t.total()).toBe(8);
  expect(t.accountTotal("acct-a", now)).toBe(5);
  expect(t.accountTotal("acct-b", now)).toBe(3);
});

test("fromJSON preserves windowHours config", () => {
  const state = {
    schema: "kunpeng-quota/v1" as const,
    records: [
      { account: "acct-a", model: "haiku", calls: 1, windowStart: 1000000 },
    ],
    windowHours: 24,
  };

  const t = QuotaTracker.fromJSON(state);

  // Window should be enforced
  const now = 1000000;
  const windowMs = 24 * 3600 * 1000;
  expect(t.accountTotal("acct-a", now + windowMs + 1)).toBe(0);
});

test("saveQuota writes tracker to file atomically", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "quota-"));
  const filePath = path.join(tmpDir, "quota.json");

  const t = new QuotaTracker({ windowHours: 24 });
  const now = 1000000;

  t.record("acct-a", "haiku", now);
  t.record("acct-b", "opus", now + 100);

  await saveQuota(filePath, t);

  const fileContent = await fs.readFile(filePath, "utf-8");
  const saved = JSON.parse(fileContent);

  expect(saved.schema).toBe("kunpeng-quota/v1");
  expect(saved.records).toHaveLength(2);
  expect(saved.windowHours).toBe(24);

  // Cleanup
  await fs.rm(tmpDir, { recursive: true });
});

test("loadQuota reads and reconstructs tracker from file", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "quota-"));
  const filePath = path.join(tmpDir, "quota.json");

  const t1 = new QuotaTracker({ windowHours: 24 });
  const now = 1000000;
  t1.record("acct-a", "haiku", now);
  t1.record("acct-b", "opus", now + 100);

  await saveQuota(filePath, t1);

  // Load it back
  const t2 = await loadQuota(filePath);

  expect(t2.total()).toBe(2);
  expect(t2.accountTotal("acct-a", now + 200)).toBe(1);
  expect(t2.accountTotal("acct-b", now + 200)).toBe(1);

  // Cleanup
  await fs.rm(tmpDir, { recursive: true });
});

test("loadQuota creates empty tracker when file missing", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "quota-"));
  const filePath = path.join(tmpDir, "nonexistent.json");

  const t = await loadQuota(filePath);

  expect(t.total()).toBe(0);
  expect(t.usage()).toHaveLength(0);

  // Cleanup
  await fs.rm(tmpDir, { recursive: true });
});

test("round-trip: save and load preserves all data", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "quota-"));
  const filePath = path.join(tmpDir, "quota.json");

  const t1 = new QuotaTracker({ windowHours: 12 });
  const now = 1000000;

  t1.record("acct-a", "haiku", now);
  t1.record("acct-a", "haiku", now + 100);
  t1.record("acct-b", "opus", now + 200);

  await saveQuota(filePath, t1);
  const t2 = await loadQuota(filePath);

  expect(t2.total()).toBe(t1.total());
  expect(t2.accountTotal("acct-a", now + 200)).toBe(t1.accountTotal("acct-a", now + 200));
  expect(t2.accountTotal("acct-b", now + 200)).toBe(t1.accountTotal("acct-b", now + 200));

  // Cleanup
  await fs.rm(tmpDir, { recursive: true });
});
