import { describe, expect, it, vi } from "vitest";
import { notifyText, type NotifyConfig } from "../../src/runtime/notify.js";

type Call = { url: string; body: string };

function stubFetch(reply: (url: string) => unknown): { fn: (url: string, init?: { body?: string }) => Promise<unknown>; calls: Call[] } {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: String(init?.body ?? "") });
    return reply(url);
  });
  return { fn, calls };
}

const okJson = (data: unknown) => ({ ok: true, status: 200, json: async () => data });

describe("notifyText：通用文本推送，送达判定不假绿（作者锁定）", () => {
  it("wxpusher 与 Server酱都成功 → 两路都记 sent，请求里带标题正文和 uid", async () => {
    const cfg: NotifyConfig = { wxpusher: { appToken: "AT_demo", uid: "UID_demo" }, serverChan: "SCTdemo" };
    const { fn, calls } = stubFetch((url) => url.includes("wxpusher") ? okJson({ success: true, code: 1000 }) : okJson({ code: 0 }));
    const r = await notifyText("测试标题X", "测试正文Y", cfg, fn);
    expect([...r.sent].sort()).toEqual(["serverchan", "wxpusher"]);
    expect(r.failed).toEqual([]);
    const wx = calls.find((c) => c.url.includes("wxpusher"));
    expect(wx).toBeDefined();
    expect(wx!.body).toContain("UID_demo");
    expect(wx!.body).toContain("测试标题X");
    expect(wx!.body).toContain("测试正文Y");
    const sc = calls.find((c) => c.url.includes("SCTdemo"));
    expect(sc).toBeDefined();
    expect(decodeURIComponent(sc!.body)).toContain("测试正文Y");
  });

  it("WxPusher 返回 HTTP 200 但 success:false（如 appToken 错）→ 记 failed，不得记 sent", async () => {
    const cfg: NotifyConfig = { wxpusher: { appToken: "bad", uid: "UID_demo" } };
    const { fn } = stubFetch(() => okJson({ success: false, code: 1001, msg: "appToken不正确" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = await notifyText("t", "b", cfg, fn);
    warn.mockRestore();
    expect(r.sent).toEqual([]);
    expect(r.failed).toEqual(["wxpusher"]);
  });

  it("HTTP 非 2xx（ok:false）→ 记 failed", async () => {
    const cfg: NotifyConfig = { serverChan: "SCTdemo" };
    const { fn } = stubFetch(() => ({ ok: false, status: 401, json: async () => ({}) }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = await notifyText("t", "b", cfg, fn);
    warn.mockRestore();
    expect(r.sent).toEqual([]);
    expect(r.failed).toEqual(["serverchan"]);
  });

  it("没有配置任何通道 → 不发请求，sent/failed 都为空", async () => {
    const { fn, calls } = stubFetch(() => okJson({}));
    expect(await notifyText("t", "b", null, fn)).toEqual({ sent: [], failed: [] });
    expect(await notifyText("t", "b", {}, fn)).toEqual({ sent: [], failed: [] });
    expect(calls.length).toBe(0);
  });
});