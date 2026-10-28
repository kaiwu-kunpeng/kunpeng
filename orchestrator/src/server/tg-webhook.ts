import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveProjectStateDir } from "../project/state-resolve.js";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { mergeAndClearGate } from "../runtime/merge-gate.js";
import { FlowTracker } from "../runtime/flowstate.js";
import { readRegistry } from "../project/registry.js";
import { loadNotifyConfig } from "../runtime/notify.js";
import { constantTimeEq } from "./auth.js";
import { describeRedeemFailure, parseImReply, redeemImTicket, type ImOutcome } from "./im-approve.js";

/**
 * Telegram 回传:按钮和 yes/no + 票据文本共用一次性兑票与合并门处置。
 * 路由 POST /tg/webhook,**绕 cockpit 账号密码鉴权**(Telegram 不会带 auth),
 * 改由 X-Telegram-Bot-Api-Secret-Token == notify.telegram.webhookSecret 守护 +
 * 校验发送者 from.id == notify.telegram.chatId(只认本人)。
 * callback_data = "kpapprove:<flowId>:<票>" / "kpreject:<flowId>:<票>"，兼容无票老按钮。
 */

type TgFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<unknown>;

async function tgCall(token: string, method: string, payload: unknown, fetchFn: TgFetch): Promise<void> {
  try {
    await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch { /* best-effort */ }
}

async function resolveFlowRepo(flowId: string, stateDir: string): Promise<string | null> {
  const projects = await readRegistry(stateDir).catch(() => []);
  for (const p of projects) {
    try { await access(join(resolveProjectStateDir(p.repoPath), `${flowId}.json`)); return p.repoPath; } catch { /* not here */ }
  }
  return null;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(""));
  });
}

async function applyGateDecision(flowId: string, action: ImOutcome, stateDir: string): Promise<string> {
  const repo = await resolveFlowRepo(flowId, stateDir);
  if (!repo) return `找不到 flow ${flowId}(可能已处理)`;
  if (action === "approve") {
    const r = await mergeAndClearGate(repo, flowId, "main", { allowSensitive: true, clearedBy: { by: "human", via: "telegram" } }).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return r.ok ? `✅ 已合并 ${flowId}` : `合并失败:${r.error ?? "未知"}`;
  }
  try {
    await new FlowTracker(resolveProjectStateDir(repo)).clearGate(flowId, { by: "human", via: "telegram" });
    return `❌ 已拒绝 ${flowId}(分支保留,未合并)`;
  } catch (e: unknown) {
    // 清门失败不能谎报「已拒绝」：告警落日志，并如实回给 Telegram。
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[tg-webhook] 拒绝 ${flowId} 时清门失败: ${msg}`);
    return `拒绝失败:${msg}(门未清,请到驾驶舱处理)`;
  }
}

export async function handleTelegramWebhook(
  req: IncomingMessage, res: ServerResponse, stateDir: string,
  fetchFn: TgFetch = ((globalThis as { fetch?: TgFetch }).fetch as TgFetch),
): Promise<void> {
  const reply = (code: number) => { res.statusCode = code; res.end(code === 200 ? "ok" : ""); };
  const cfg = await loadNotifyConfig();
  const tg = cfg?.telegram;
  if (!tg?.token) { reply(404); return; }
  // 验签:secret 不符直接 401(防伪造回调触发合并)。
  const headerSecret = req.headers["x-telegram-bot-api-secret-token"];
  if (!tg.webhookSecret || !constantTimeEq(typeof headerSecret === "string" ? headerSecret : "", tg.webhookSecret)) {
    reply(401); return;
  }

  let update: {
    callback_query?: { id: string; data?: string; from?: { id: number }; message?: { chat?: { id: number }; message_id?: number } };
    message?: { text?: string; from?: { id: number }; chat?: { id: number } };
  };
  try { update = JSON.parse(await readBody(req)); } catch { reply(200); return; }
  const cq = update?.callback_query;
  if (!cq) {
    const message = update?.message;
    // 外人和闲聊静默忽略，不回 Telegram 消息，也不动票据或门。
    if (!tg.chatId || String(message?.from?.id ?? "") !== String(tg.chatId) || typeof message?.text !== "string") {
      reply(200); return;
    }
    const command = parseImReply(message.text);
    if (!command) { reply(200); return; }
    const result = await redeemImTicket(stateDir, command.id, { by: `telegram:${message.from!.id}`, outcome: command.outcome });
    const resultText = result.ok
      ? await applyGateDecision(result.ticket.flowId, command.outcome, stateDir)
      : describeRedeemFailure(result);
    await tgCall(tg.token, "sendMessage", { chat_id: tg.chatId, text: resultText }, fetchFn);
    reply(200); return;
  }

  // 只认配置的本人 chatId
  if (!tg.chatId || String(cq.from?.id ?? "") !== String(tg.chatId)) {
    await tgCall(tg.token, "answerCallbackQuery", { callback_query_id: cq.id, text: "无权操作" }, fetchFn);
    reply(200); return;
  }

  const data = cq.data ?? "";
  const m = /^kp(approve|reject):([^:]+)(?::([a-z0-9]{6}))?$/.exec(data);
  if (!m) { await tgCall(tg.token, "answerCallbackQuery", { callback_query_id: cq.id }, fetchFn); reply(200); return; }
  const action = m[1] as ImOutcome;
  const flowId = m[2];
  const ticketId = m[3];
  if (ticketId) {
    const result = await redeemImTicket(stateDir, ticketId, { by: `telegram:${cq.from!.id}`, outcome: action });
    if (!result.ok) {
      await tgCall(tg.token, "answerCallbackQuery", { callback_query_id: cq.id, text: describeRedeemFailure(result) }, fetchFn);
      reply(200); return;
    }
    if (result.ticket.flowId !== flowId) {
      await tgCall(tg.token, "answerCallbackQuery", { callback_query_id: cq.id, text: `该审批票据不属于流 ${flowId}` }, fetchFn);
      reply(200); return;
    }
  }
  const resultText = await applyGateDecision(flowId, action, stateDir);

  await tgCall(tg.token, "answerCallbackQuery", { callback_query_id: cq.id, text: resultText }, fetchFn);
  if (cq.message?.chat?.id && cq.message.message_id) {
    await tgCall(tg.token, "editMessageText", {
      chat_id: cq.message.chat.id, message_id: cq.message.message_id,
      text: `鲲鹏合并门 ${flowId}\n${resultText}`,
    }, fetchFn);
  }
  reply(200);
}

/** 把 Telegram webhook 指到 cockpit(notify 配置齐全时,保存设置后自动调用)。 */
export async function setTelegramWebhook(
  token: string, cockpitUrl: string, secret: string,
  fetchFn: TgFetch = ((globalThis as { fetch?: TgFetch }).fetch as TgFetch),
): Promise<void> {
  const url = `${cockpitUrl.replace(/\/+$/, "")}/tg/webhook`;
  await tgCall(token, "setWebhook", { url, secret_token: secret, allowed_updates: ["callback_query", "message"] }, fetchFn);
}
