import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { saveBackendConfig } from "../../agent/backend-config.js";
import { loadNotifyConfig, notifyText, saveNotifyConfig, type NotifyConfig } from "../../runtime/notify.js";
import { resolveRepo } from "../project-scope.js";
import { readJsonBody } from "../read-body.js";
import { setTelegramWebhook } from "../tg-webhook.js";
import { registerModularRoute, type RouteContext } from "./registry.js";

const MASK = "••••";

/** 密钥打码：只露末 4 位；≤8 位的短密钥整条打码、不露任何字符。 */
function maskSecret(value: string): string {
  if (!value) return "";
  return value.length > 8 ? `${MASK}${value.slice(-4)}` : MASK.repeat(2);
}

/** 原样交回的打码值还原为已存真值；空串仍表示清空，其它一律视为新值。 */
function unmaskSecret(incoming: string, prev: string | undefined): string {
  return prev && incoming === maskSecret(prev) ? prev : incoming;
}

const notifyHandle = async (
  req: IncomingMessage,
  res: ServerResponse,
  _url: string,
  _context: RouteContext,
): Promise<void> => {
  res.setHeader("content-type", "application/json");
  if (req.method === "GET") {
    const cfg = await loadNotifyConfig();
    res.end(JSON.stringify({
      ok: true,
      cockpitUrl: cfg?.cockpitUrl ?? "",
      tgToken: maskSecret(cfg?.telegram?.token ?? ""), tgChat: cfg?.telegram?.chatId ?? "",
      wxToken: maskSecret(cfg?.wxpusher?.appToken ?? ""), wxUid: cfg?.wxpusher?.uid ?? "",
      serverChan: maskSecret(cfg?.serverChan ?? ""), wecom: maskSecret(cfg?.wechatWebhook ?? ""),
    }));
    return;
  }
  if (req.method === "POST") {
    const b = await readJsonBody(req);
    const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const prev = await loadNotifyConfig();
    const cfg: NotifyConfig = {};
    const tgToken = unmaskSecret(s(b.tgToken), prev?.telegram?.token);
    const wxToken = unmaskSecret(s(b.wxToken), prev?.wxpusher?.appToken);
    const serverChan = unmaskSecret(s(b.serverChan), prev?.serverChan);
    const wecom = unmaskSecret(s(b.wecom), prev?.wechatWebhook);
    if (s(b.cockpitUrl)) cfg.cockpitUrl = s(b.cockpitUrl);
    if (tgToken && s(b.tgChat)) cfg.telegram = { token: tgToken, chatId: s(b.tgChat), webhookSecret: prev?.telegram?.webhookSecret || randomBytes(16).toString("hex") };
    if (wxToken && s(b.wxUid)) cfg.wxpusher = { appToken: wxToken, uid: s(b.wxUid) };
    if (serverChan) cfg.serverChan = serverChan;
    if (wecom) cfg.wechatWebhook = wecom;
    try {
      await saveNotifyConfig(cfg);
      // Telegram+cockpit 地址齐全 → 自动 setWebhook,让聊天里点按钮直批生效。
      if (cfg.telegram && cfg.cockpitUrl) void setTelegramWebhook(cfg.telegram.token, cfg.cockpitUrl, cfg.telegram.webhookSecret!).catch(() => {});
      res.end(JSON.stringify({ ok: true, telegramHook: !!(cfg.telegram && cfg.cockpitUrl) }));
    } catch { res.end(JSON.stringify({ ok: false, error: "保存失败" })); }
    return;
  }
};

registerModularRoute({ method: "GET", path: "/api/settings/notify", handle: notifyHandle });
registerModularRoute({ method: "POST", path: "/api/settings/notify", handle: notifyHandle });

registerModularRoute({
  method: "POST",
  path: "/api/settings/notify/test",
  handle: async (_req, res) => {
    res.setHeader("content-type", "application/json");
    const cfg = await loadNotifyConfig();
    const { sent, failed } = await notifyText("🔔 鲲鹏 · 测试推送", "这是一条测试消息，用于确认已保存的通讯通道可以接收推送。", cfg);
    if (sent.length === 0 && failed.length === 0) {
      res.end(JSON.stringify({ ok: false, sent, failed, error: "未配置任何通讯通道，请先保存通讯设置。" }));
      return;
    }
    res.end(JSON.stringify({ ok: failed.length === 0, sent, failed }));
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/settings/backends",
  handle: async (req, res, _url, context: RouteContext) => {
    const reqBody = await readJsonBody(req);
    const projectId = String(reqBody.projectId ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    try {
      const config = await saveBackendConfig(repoRoot, reqBody);
      res.end(JSON.stringify({ ok: true, config }));
    } catch {
      res.end(JSON.stringify({ ok: false, error: "保存后端配置失败" }));
    }
    return;
  },
});
