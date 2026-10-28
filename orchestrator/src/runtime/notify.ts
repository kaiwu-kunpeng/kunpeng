import { readFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "../util/atomic-write.js";
import { isHardGateLevel, type ActionLevel } from "../policy/action-levels.js";

/**
 * 手机推送(远程批门):合并门出现时推到手机,用户点深链回 cockpit 批准。
 * 配置 ~/.kunpeng/notify.json —— 全部可选,填了哪个推哪个:
 * {
 *   "cockpitUrl": "https://cockpit.example.com",
 *   "telegram": { "token": "<botToken>", "chatId": "<chatId>" },
 *   "serverChan": "<sendkey>",   // Server酱(方糖)→ 推到【个人微信】(免费 5 条/天)
 *   "wxpusher": { "appToken": "<token>", "uid": "<uid>" },  // WxPusher → 推到【个人微信】(无日限)
 *   "wechatWebhook": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<key>"  // 企业微信群机器人(需企业微信,个人微信用上面两个)
 * }
 */
export interface NotifyConfig {
  cockpitUrl?: string;
  telegram?: { token: string; chatId: string; webhookSecret?: string };
  serverChan?: string;
  wxpusher?: { appToken: string; uid: string };
  wechatWebhook?: string;
}

export async function loadNotifyConfig(home = homedir()): Promise<NotifyConfig | null> {
  try {
    const raw = await readFile(join(home, ".kunpeng", "notify.json"), "utf8");
    const cfg = JSON.parse(raw) as NotifyConfig;
    return cfg && typeof cfg === "object" ? cfg : null;
  } catch {
    return null;
  }
}

export async function saveNotifyConfig(cfg: NotifyConfig, home = homedir()): Promise<void> {
  const dir = join(home, ".kunpeng");
  await mkdir(dir, { recursive: true });
  await writeFileAtomic(join(dir, "notify.json"), JSON.stringify(cfg, null, 2));
}

/** 注入式 fetch,便于测试。 */
type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<unknown>;

const NOTIFY_TIMEOUT_MS = 10_000;

export async function fetchWithRetry(fetchFn: FetchFn, url: string, init?: Parameters<FetchFn>[1]): Promise<unknown> {
  const once = () => fetchFn(url, { ...(init ?? {}), signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS) });
  try { return await once(); }
  catch { await new Promise((r) => setTimeout(r, 500)); return once(); }
}

/** 推送通用文本；HTTP 或通道业务失败均记入 failed，不影响其它通道。 */
export async function notifyText(
  title: string, body: string, cfg: NotifyConfig | null,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<{ sent: string[]; failed: string[] }> {
  const sent: string[] = [];
  const failed: string[] = [];
  if (!cfg) return { sent, failed };

  const send = async (channel: string, url: string, init: Parameters<FetchFn>[1]): Promise<void> => {
    try {
      const response = await fetchWithRetry(fetchFn, url, init) as {
        ok?: boolean;
        status?: number;
        json(): Promise<{ success?: boolean } | null>;
      };
      if (response.ok === false) throw new Error(`HTTP ${response.status}`);
      if (channel === "wxpusher" && (await response.json())?.success === false) {
        throw new Error("WxPusher 返回 success:false");
      }
      sent.push(channel);
    } catch (error) {
      console.warn(`[通知] ${channel} 推送失败: ${String(error).slice(0, 120)}`);
      failed.push(channel);
    }
  };

  const jobs: Array<Promise<void>> = [];
  if (cfg.telegram?.token && cfg.telegram.chatId) {
    jobs.push(send("telegram", `https://api.telegram.org/bot${cfg.telegram.token}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: cfg.telegram.chatId, text: `*${title}*\n${body}`, parse_mode: "Markdown" }),
    }));
  }
  if (cfg.wechatWebhook) {
    jobs.push(send("wechat", cfg.wechatWebhook, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ msgtype: "markdown", markdown: { content: `**${title}**\n${body}` } }),
    }));
  }
  if (cfg.serverChan) {
    jobs.push(send("serverchan", `https://sctapi.ftqq.com/${cfg.serverChan}.send`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `title=${encodeURIComponent(title)}&desp=${encodeURIComponent(body)}`,
    }));
  }
  if (cfg.wxpusher?.appToken && cfg.wxpusher.uid) {
    jobs.push(send("wxpusher", "https://wxpusher.zjiecode.com/api/send/message", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        appToken: cfg.wxpusher.appToken,
        content: `**${title}**\n${body}`,
        contentType: 3,
        summary: title.slice(0, 99),
        uids: [cfg.wxpusher.uid],
      }),
    }));
  }
  await Promise.all(jobs);
  return { sent, failed };
}

export interface MergeGateNotifyOptions {
  ticket?: string;
  level?: ActionLevel;
}

/** 推送一条"待批合并门"通知到所有已配置通道(best-effort,任一失败不影响其它)。 */
export async function notifyMergeGate(
  flowId: string, what: string, cfg: NotifyConfig | null,
  fetchFn: FetchFn = ((globalThis as { fetch?: FetchFn }).fetch as FetchFn),
  opts: MergeGateNotifyOptions = {},
): Promise<{ sent: string[]; failed: string[] }> {
  const sent: string[] = [];
  const failed: string[] = [];
  if (!cfg || !fetchFn) return { sent, failed };
  const link = `${(cfg.cockpitUrl ?? "").replace(/\/+$/, "")}/#/inbox`;
  const title = "🔔 鲲鹏 · 待批合并门";
  const body = `${flowId}\n${what}\n点此审批:${link}`;

  const jobs: Array<Promise<void>> = [];

  if (cfg.telegram?.token && cfg.telegram.chatId) {
    const suffix = opts.ticket ? `:${opts.ticket}` : "";
    const capped = isHardGateLevel(opts.level);
    const hint = (opts.ticket ? `\n也可回复 yes ${opts.ticket} / no ${opts.ticket}` : "")
      + (capped ? `\n该门为 ${opts.level}，IM 入口只能拒绝，批准请到驾驶舱` : "");
    jobs.push((async () => {
      try {
        await fetchWithRetry(fetchFn, `https://api.telegram.org/bot${cfg.telegram!.token}/sendMessage`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: cfg.telegram!.chatId,
            text: `*${title}*\n${flowId}\n${what}${hint}`,
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  ...(!capped ? [{ text: "✅ 批准合并", callback_data: `kpapprove:${flowId}${suffix}` }] : []),
                  { text: "❌ 拒绝", callback_data: `kpreject:${flowId}${suffix}` },
                ],
                ...(link ? [[{ text: "打开 cockpit →", url: link }]] : []),
              ],
            },
          }),
        });
        sent.push("telegram");
      } catch (e) {
        console.warn(`[通知] telegram 推送失败: ${String(e).slice(0, 120)}`);
        failed.push("telegram");
      }
    })());
  }

  if (cfg.wechatWebhook) {
    jobs.push((async () => {
      try {
        await fetchWithRetry(fetchFn, cfg.wechatWebhook!, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ msgtype: "markdown", markdown: { content: `**${title}**\n${flowId}\n${what}\n[点此审批](${link})` } }),
        });
        sent.push("wechat");
      } catch (e) {
        console.warn(`[通知] wechat 推送失败: ${String(e).slice(0, 120)}`);
        failed.push("wechat");
      }
    })());
  }

  if (cfg.serverChan) {
    jobs.push((async () => {
      try {
        await fetchWithRetry(fetchFn, `https://sctapi.ftqq.com/${cfg.serverChan}.send`, {
          method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
          body: `title=${encodeURIComponent(title)}&desp=${encodeURIComponent(body)}`,
        });
        sent.push("serverchan");
      } catch (e) {
        console.warn(`[通知] serverchan 推送失败: ${String(e).slice(0, 120)}`);
        failed.push("serverchan");
      }
    })());
  }

  if (cfg.wxpusher?.appToken && cfg.wxpusher.uid) {
    jobs.push((async () => {
      try {
        await fetchWithRetry(fetchFn, "https://wxpusher.zjiecode.com/api/send/message", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            appToken: cfg.wxpusher!.appToken,
            content: `**${title}**\n${flowId}\n${what}\n[点此审批](${link})`,
            contentType: 3, // markdown
            summary: `待批合并门 ${flowId}`.slice(0, 99),
            uids: [cfg.wxpusher!.uid],
            url: link || undefined,
          }),
        });
        sent.push("wxpusher");
      } catch (e) {
        console.warn(`[通知] wxpusher 推送失败: ${String(e).slice(0, 120)}`);
        failed.push("wxpusher");
      }
    })());
  }

  await Promise.allSettled(jobs);
  return { sent, failed };
}
