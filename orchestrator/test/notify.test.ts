import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadNotifyConfig, notifyMergeGate, saveNotifyConfig } from "../src/runtime/notify.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kp-notify-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

test("saveNotifyConfig writes ~/.kunpeng/notify.json and loadNotifyConfig reads it back", async () => {
  await saveNotifyConfig(
    {
      cockpitUrl: "https://cockpit.example",
      telegram: { token: "tg-token", chatId: "42", webhookSecret: "secret" },
      serverChan: "server-key",
      wxpusher: { appToken: "wx-token", uid: "uid-1" },
      wechatWebhook: "https://qy.example/webhook",
    },
    home,
  );

  const raw = readFileSync(join(home, ".kunpeng", "notify.json"), "utf8");
  expect(JSON.parse(raw)).toEqual({
    cockpitUrl: "https://cockpit.example",
    telegram: { token: "tg-token", chatId: "42", webhookSecret: "secret" },
    serverChan: "server-key",
    wxpusher: { appToken: "wx-token", uid: "uid-1" },
    wechatWebhook: "https://qy.example/webhook",
  });
  expect(raw).toContain('\n  "telegram"');

  await expect(loadNotifyConfig(home)).resolves.toEqual({
    cockpitUrl: "https://cockpit.example",
    telegram: { token: "tg-token", chatId: "42", webhookSecret: "secret" },
    serverChan: "server-key",
    wxpusher: { appToken: "wx-token", uid: "uid-1" },
    wechatWebhook: "https://qy.example/webhook",
  });
});

test("loadNotifyConfig returns null for missing or malformed config", async () => {
  await expect(loadNotifyConfig(home)).resolves.toBeNull();

  mkdirSync(join(home, ".kunpeng"), { recursive: true });
  writeFileSync(join(home, ".kunpeng", "notify.json"), "{bad json", "utf8");
  await expect(loadNotifyConfig(home)).resolves.toBeNull();
});

test("notifyMergeGate sends normalized payloads to every configured channel", async () => {
  const calls: Array<{ url: string; init: { method?: string; headers?: Record<string, string>; body?: string } | undefined }> = [];
  const fetchFn = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    calls.push({ url, init });
    return {};
  };

  const result = await notifyMergeGate(
    "flow-123",
    "kp/flow-123 -> main",
    {
      cockpitUrl: "https://cockpit.example/",
      telegram: { token: "tg-token", chatId: "42" },
      wechatWebhook: "https://qy.example/webhook",
      serverChan: "server-key",
      wxpusher: { appToken: "wx-token", uid: "uid-1" },
    },
    fetchFn,
  );

  expect(result.sent.sort()).toEqual(["serverchan", "telegram", "wechat", "wxpusher"]);
  expect(result.failed).toEqual([]);
  expect(calls).toHaveLength(4);

  const telegram = calls.find((call) => call.url === "https://api.telegram.org/bottg-token/sendMessage");
  expect(telegram?.init?.headers?.["content-type"]).toBe("application/json");
  const telegramBody = JSON.parse(telegram?.init?.body ?? "{}") as {
    chat_id?: string;
    text?: string;
    reply_markup?: { inline_keyboard?: Array<Array<{ text: string; callback_data?: string; url?: string }>> };
  };
  expect(telegramBody.chat_id).toBe("42");
  expect(telegramBody.text).toContain("flow-123");
  expect(telegramBody.text).toContain("kp/flow-123 -> main");
  expect(telegramBody.reply_markup?.inline_keyboard?.[0]?.map((button) => button.callback_data)).toEqual([
    "kpapprove:flow-123",
    "kpreject:flow-123",
  ]);
  expect(telegramBody.reply_markup?.inline_keyboard?.[1]?.[0]?.url).toBe("https://cockpit.example/#/inbox");

  const wechat = calls.find((call) => call.url === "https://qy.example/webhook");
  const wechatBody = JSON.parse(wechat?.init?.body ?? "{}") as { msgtype?: string; markdown?: { content?: string } };
  expect(wechatBody.msgtype).toBe("markdown");
  expect(wechatBody.markdown?.content).toContain("[点此审批](https://cockpit.example/#/inbox)");

  const serverChan = calls.find((call) => call.url === "https://sctapi.ftqq.com/server-key.send");
  expect(serverChan?.init?.headers?.["content-type"]).toBe("application/x-www-form-urlencoded");
  expect(decodeURIComponent(serverChan?.init?.body ?? "")).toContain("flow-123");
  expect(decodeURIComponent(serverChan?.init?.body ?? "")).toContain("kp/flow-123 -> main");

  const wxpusher = calls.find((call) => call.url === "https://wxpusher.zjiecode.com/api/send/message");
  const wxBody = JSON.parse(wxpusher?.init?.body ?? "{}") as {
    appToken?: string;
    contentType?: number;
    summary?: string;
    uids?: string[];
    url?: string;
  };
  expect(wxBody).toMatchObject({
    appToken: "wx-token",
    contentType: 3,
    summary: "待批合并门 flow-123",
    uids: ["uid-1"],
    url: "https://cockpit.example/#/inbox",
  });
});

test("notifyMergeGate is best-effort per channel and reports failures", async () => {
  const fetchFn = async (url: string) => {
    if (url.includes("sctapi.ftqq.com")) throw new Error("serverchan down");
    return {};
  };

  const result = await notifyMergeGate(
    "flow-456",
    "ready",
    {
      telegram: { token: "tg-token", chatId: "42" },
      serverChan: "server-key",
    },
    fetchFn,
  );

  expect(result.sent).toEqual(["telegram"]);
  expect(result.failed).toEqual(["serverchan"]);
});
