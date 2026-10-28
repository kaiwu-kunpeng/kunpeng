import { describe, it, expect } from "vitest";
import { pickAccount, resolveAccounts, type Account } from "../../src/agent/account-pool.js";
import { QuotaTracker } from "../../src/agent/quota-tracker.js";

const claudeOnly: Account = { id: "a-claude", name: "alice", backend: "claude" };
const codexOnly: Account = { id: "a-codex", name: "bob", backend: "codex" };
const universal: Account = { id: "a-uni" };

describe("账号 A1:name/backend 语义与按后端过滤", () => {
  it("resolveAccounts 保留 name/backend,非法 backend 报错", () => {
    const [acct] = resolveAccounts([{ id: "x", name: "alice", backend: "claude" }]);
    expect(acct.name).toBe("alice");
    expect(acct.backend).toBe("claude");
    expect(() => resolveAccounts([{ id: "x", backend: "gemini" }])).toThrow(/backend/);
    expect(() => resolveAccounts([{ id: "x", name: "" }])).toThrow(/name/);
  });

  it("backend 过滤:codex 阶段选不到 claude 专属账号,通用账号两家都可选", () => {
    const quota = new QuotaTracker();
    expect(pickAccount([claudeOnly, codexOnly], quota, 0, "codex")?.id).toBe("a-codex");
    expect(pickAccount([claudeOnly], quota, 0, "codex")).toBeUndefined();
    expect(pickAccount([universal], quota, 0, "codex")?.id).toBe("a-uni");
    expect(pickAccount([universal], quota, 0, "claude")?.id).toBe("a-uni");
  });

  it("既有语义保留:空池 throw、耗尽 throw、不传 backend 不过滤", () => {
    const quota = new QuotaTracker();
    expect(() => pickAccount([], quota, 0)).toThrow(/未配置账号/);
    expect(pickAccount([claudeOnly, codexOnly], quota, 0)?.id).toBeDefined();
    const limited: Account = { id: "a-lim", backend: "codex", limit: 1, windowHours: 5 };
    quota.record("a-lim", "m");
    expect(() => pickAccount([limited], quota, Date.now(), "codex")).toThrow(/配额耗尽/);
  });
});