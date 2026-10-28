import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { notifyMergeGate, loadNotifyConfig, saveNotifyConfig, type NotifyConfig } from "../../src/runtime/notify.js";

describe("notifyMergeGate", () => {
  it("四通道各命中 URL + telegram 带批准/拒绝回调按钮 + wxpusher 带 uid", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fake = async (url: string, init?: { body?: string }) => { calls.push({ url, body: init?.body ?? "" }); return {}; };
    const cfg: NotifyConfig = {
      cockpitUrl: "https://c.example.com",
      telegram: { token: "TK", chatId: "9", webhookSecret: "s" },
      wechatWebhook: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=K",
      serverChan: "SCT",
      wxpusher: { appToken: "AT", uid: "U7" },
    };
    const r = await notifyMergeGate("flow-1", "kp/flow-1 → main", cfg, fake);
    expect(r.sent.sort()).toEqual(["serverchan", "telegram", "wechat", "wxpusher"]);
    const tg = calls.find((c) => c.url.includes("api.telegram.org"))!;
    expect(tg.body).toContain("kpapprove:flow-1");
    expect(tg.body).toContain("kpreject:flow-1");
    expect(calls.find((c) => c.url.includes("qyapi.weixin"))!.body).toContain("flow-1");
    expect(calls.some((c) => c.url.includes("sctapi.ftqq.com/SCT.send"))).toBe(true);
    expect(calls.find((c) => c.url.includes("wxpusher.zjiecode.com"))!.body).toContain("U7");
  });

  it("无配置 → 不发任何请求", async () => {
    const calls: string[] = [];
    const fake = async (url: string) => { calls.push(url); return {}; };
    const r = await notifyMergeGate("f", "w", null, fake);
    expect(calls).toEqual([]);
    expect(r.sent).toEqual([]);
  });
});

describe("load/saveNotifyConfig", () => {
  it("保存后能读回同一份配置", async () => {
    const home = mkdtempSync(join(tmpdir(), "kp-notify-"));
    try {
      expect(await loadNotifyConfig(home)).toBeNull();
      const cfg: NotifyConfig = { cockpitUrl: "https://x", serverChan: "K9" };
      await saveNotifyConfig(cfg, home);
      expect(await loadNotifyConfig(home)).toEqual(cfg);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
