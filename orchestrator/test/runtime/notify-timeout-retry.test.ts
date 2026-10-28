import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWithRetry, notifyMergeGate, type NotifyConfig } from "../../src/runtime/notify.js";

afterEach(() => { vi.restoreAllMocks(); });

describe("B4:通知超时与重试", () => {
  it("fetchWithRetry 注入 AbortSignal,首败重试一次", async () => {
    const calls: unknown[] = [];
    let first = true;
    const fetchFn = async (_url: string, init?: { signal?: AbortSignal }) => {
      calls.push(init?.signal);
      if (first) { first = false; throw new Error("boom"); }
      return { ok: true };
    };
    const result = await fetchWithRetry(fetchFn as never, "https://x.test", { method: "POST" });
    expect(result).toEqual({ ok: true });
    expect(calls.length).toBe(2);
    expect(calls[0]).toBeInstanceOf(AbortSignal);
  });

  it("两次都失败向上抛", async () => {
    const fetchFn = async () => { throw new Error("down"); };
    await expect(fetchWithRetry(fetchFn as never, "https://x.test")).rejects.toThrow("down");
  });

  it("notifyMergeGate:重试后成功入 sent;彻底失败入 failed(纯渠道名)且 warn 带原因", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg: NotifyConfig = { wechatWebhook: "https://hook.test/send" };
    let first = true;
    const flaky = async () => { if (first) { first = false; throw new Error("flaky"); } return {}; };
    const r1 = await notifyMergeGate("f1", "w", cfg, flaky as never);
    expect(r1.sent).toContain("wechat");
    const dead = async () => { throw new Error("dead-net"); };
    const r2 = await notifyMergeGate("f2", "w", cfg, dead as never);
    expect(r2.failed).toContain("wechat");
    expect(warn.mock.calls.some((c) => String(c[0]).includes("推送失败") && String(c[0]).includes("dead-net"))).toBe(true);
  });
});