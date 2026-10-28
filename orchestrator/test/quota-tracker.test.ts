import { expect, test } from "vitest";
import { QuotaTracker } from "../src/agent/quota-tracker.js";

test("counts per (account, model) dimension and totals across them", () => {
  const t = new QuotaTracker();
  t.record("acct-a", "haiku");
  t.record("acct-a", "haiku");
  t.record("acct-a", "opus");

  expect(t.total()).toBe(3);

  const usage = t.usage();
  const haiku = usage.find((r) => r.account === "acct-a" && r.model === "haiku");
  const opus = usage.find((r) => r.model === "opus");
  expect(haiku?.calls).toBe(2);
  expect(opus?.calls).toBe(1);
});
