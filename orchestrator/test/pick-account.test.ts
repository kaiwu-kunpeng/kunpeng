import { describe, expect, test } from "vitest";
import { pickAccount, type Account } from "../src/agent/account-pool.js";
import { QuotaTracker } from "../src/agent/quota-tracker.js";

function trackerWithUsage(
  usage: Record<string, number>,
  now: number,
  options?: { windowHours?: number }
): QuotaTracker {
  const quota = new QuotaTracker(options);
  for (const [account, count] of Object.entries(usage)) {
    for (let i = 0; i < count; i++) {
      quota.record(account, "haiku", now);
    }
  }
  return quota;
}

describe("pickAccount", () => {
  test.each([
    {
      name: "全可用选最少",
      accounts: [{ id: "a" }, { id: "b" }, { id: "c" }],
      usage: { a: 3, b: 1, c: 2 },
      expected: "b",
    },
    {
      name: "跳过用尽的账号",
      accounts: [
        { id: "a", limit: 2 },
        { id: "b", limit: 10 },
        { id: "c", limit: 10 },
      ],
      usage: { a: 2, b: 4, c: 5 },
      expected: "b",
    },
    {
      name: "并列取前",
      accounts: [{ id: "a" }, { id: "b" }, { id: "c" }],
      usage: { a: 2, b: 1, c: 1 },
      expected: "b",
    },
  ])("$name", ({ accounts, usage, expected }) => {
    const now = 1_000_000;
    const quota = trackerWithUsage(usage, now);

    expect(pickAccount(accounts, quota, now)?.id).toBe(expected);
  });

  test("全满时抛错且错消息含倒计时", () => {
    const now = 1_000_000;
    const quota = new QuotaTracker({ windowHours: 1 });
    quota.record("a", "haiku", now);
    quota.record("b", "haiku", now + 10 * 60_000);

    const accounts: Account[] = [
      { id: "a", limit: 1, windowHours: 1 },
      { id: "b", limit: 1, windowHours: 1 },
    ];

    expect(() => pickAccount(accounts, quota, now + 30 * 60_000)).toThrow(
      "所有账号配额耗尽，最近重置约 30m 后"
    );
  });

  test("数组为空抛错", () => {
    const quota = new QuotaTracker();

    expect(() => pickAccount([], quota, 1_000_000)).toThrow("未配置账号");
  });

  test("不修改入参数组或账号对象", () => {
    const now = 1_000_000;
    const accounts: Account[] = [
      { id: "a", limit: 10 },
      { id: "b", limit: 10 },
    ];
    const before = accounts.map((account) => ({ ...account }));
    const quota = trackerWithUsage({ a: 2, b: 1 }, now);

    expect(pickAccount(accounts, quota, now)?.id).toBe("b");
    expect(accounts).toEqual(before);
  });
});
