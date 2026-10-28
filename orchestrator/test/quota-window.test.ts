import { expect, test } from "vitest";
import { QuotaTracker } from "../src/agent/quota-tracker.js";

test("tracks calls without window when windowHours not set", () => {
  const t = new QuotaTracker();
  const now = 1000000;

  t.record("acct-a", "haiku", now);
  t.record("acct-a", "haiku", now + 1000);
  t.record("acct-a", "opus", now + 2000);

  expect(t.total()).toBe(3);
  const usage = t.usage();
  const haiku = usage.find((r) => r.account === "acct-a" && r.model === "haiku");
  const opus = usage.find((r) => r.model === "opus");
  expect(haiku?.calls).toBe(2);
  expect(opus?.calls).toBe(1);
});

test("initializes windowStart on first record", () => {
  const t = new QuotaTracker({ windowHours: 24 });
  const now = 1000000;

  t.record("acct-a", "haiku", now);

  const usage = t.usage();
  const record = usage.find((r) => r.account === "acct-a" && r.model === "haiku");
  expect(record?.windowStart).toBe(now);
});

test("resets window when it expires", () => {
  const t = new QuotaTracker({ windowHours: 1 });
  const now = 1000000;
  const windowMs = 1 * 3600 * 1000;

  t.record("acct-a", "haiku", now);
  t.record("acct-a", "haiku", now + 100);
  expect(t.accountTotal("acct-a", now + 100)).toBe(2);

  // Window expires: now + windowMs time passes
  t.record("acct-a", "haiku", now + windowMs + 100);

  // After window reset, count should be 1 (the new record)
  expect(t.accountTotal("acct-a", now + windowMs + 100)).toBe(1);
});

test("accountTotal returns sum across all models in current window", () => {
  const t = new QuotaTracker({ windowHours: 24 });
  const now = 1000000;

  t.record("acct-a", "haiku", now);
  t.record("acct-a", "haiku", now + 100);
  t.record("acct-a", "opus", now + 200);
  t.record("acct-b", "haiku", now + 300);

  expect(t.accountTotal("acct-a", now + 300)).toBe(3); // 2 haiku + 1 opus
  expect(t.accountTotal("acct-b", now + 300)).toBe(1); // 1 haiku
});

test("accountTotal returns 0 for expired window", () => {
  const t = new QuotaTracker({ windowHours: 1 });
  const now = 1000000;
  const windowMs = 1 * 3600 * 1000;

  t.record("acct-a", "haiku", now);
  t.record("acct-a", "opus", now + 100);

  // Query after window expires
  expect(t.accountTotal("acct-a", now + windowMs + 1)).toBe(0);
});

test("windowResetMs returns remaining time until reset", () => {
  const t = new QuotaTracker({ windowHours: 1 });
  const now = 1000000;
  const windowMs = 1 * 3600 * 1000;

  t.record("acct-a", "haiku", now);

  // 30 minutes later
  const remaining = t.windowResetMs("acct-a", now + 30 * 60 * 1000);
  expect(remaining).toBe(30 * 60 * 1000); // 30 minutes remaining

  // At window boundary
  const atBoundary = t.windowResetMs("acct-a", now + windowMs);
  expect(atBoundary).toBe(0);
});

test("windowResetMs returns undefined when no window is set", () => {
  const t = new QuotaTracker();
  const now = 1000000;

  t.record("acct-a", "haiku", now);

  expect(t.windowResetMs("acct-a", now)).toBeUndefined();
});

test("windowResetMs returns undefined for non-existent account", () => {
  const t = new QuotaTracker({ windowHours: 24 });
  const now = 1000000;

  expect(t.windowResetMs("unknown", now)).toBeUndefined();
});

test("preserves calls from different accounts separately", () => {
  const t = new QuotaTracker({ windowHours: 24 });
  const now = 1000000;

  t.record("acct-a", "haiku", now);
  t.record("acct-a", "opus", now + 100);
  t.record("acct-b", "haiku", now + 200);

  expect(t.accountTotal("acct-a", now + 200)).toBe(2);
  expect(t.accountTotal("acct-b", now + 200)).toBe(1);
});
