import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { neonRunner } from "../db/neon-runner.js";
import { newMessage, SwitchboardStore } from "../switchboard/store.js";
import { readAuthConfig, decideWebhookAuth } from "./auth.js";
import { ensureCrawlerTable, handleDrainPayload } from "./crawler/collector.js";
import { handleDispatch } from "./dispatch-endpoint.js";
import { readJsonBody, readRawBody } from "./read-body.js";
import { handleTelegramWebhook } from "./tg-webhook.js";

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function handleWebhookHttpRoute(method: string, path: string, url: string, req: IncomingMessage, res: ServerResponse, deps: { stateDir: string; remoteIsLoopback: boolean }): Promise<boolean> {
  // Telegram 回调:绕鉴权(Telegram 不带 auth),由 webhook secret + chatId 守护。
  if (method === "POST" && path === "/tg/webhook") {
    const authCfg = await readAuthConfig(deps.stateDir);
    if (decideWebhookAuth({
      configuredSecret: authCfg?.webhookSecret,
      headerSecret: firstHeader(req.headers["x-kp-webhook-secret"]),
      remoteIsLoopback: deps.remoteIsLoopback,
    }) === "deny") {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return true;
    }
    await handleTelegramWebhook(req, res, deps.stateDir);
    return true;
  }

  // 事件派单 webhook：GitHub 风格事件(label/body 标记)→解析意图→广播到 switchboard 供驱动器/人接单。
  // 同 tg/webhook 绕 kunpeng auth；由 webhook secret + loopback 判定守卫。
  if (method === "POST" && path === "/api/dispatch") {
    const authCfg = await readAuthConfig(deps.stateDir);
    if (decideWebhookAuth({
      configuredSecret: authCfg?.webhookSecret,
      headerSecret: firstHeader(req.headers["x-kp-webhook-secret"]),
      remoteIsLoopback: deps.remoteIsLoopback,
    }) === "deny") {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return true;
    }
    try {
      const body = await readJsonBody(req);
      const result = await handleDispatch(body, async (intent) => {
        const sb = new SwitchboardStore(join(deps.stateDir, "switchboard"));
        await sb.append(newMessage(
          { from: "dispatch", to: "all", topic: "dispatch", body: `事件派单：${intent.requirement.slice(0, 80)} → ${intent.branch}`, origin: { kind: "channel" } },
          { id: () => `disp-${Date.now().toString(36)}`, now: () => Date.now() },
        ));
      });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: String((error as Error).message ?? error) }));
    }
    return true;
  }

  if (method === "POST" && path === "/api/drain") {
    res.setHeader("content-type", "application/json");
    const authCfg = await readAuthConfig(deps.stateDir);
    if (decideWebhookAuth({
      configuredSecret: authCfg?.webhookSecret,
      headerSecret: firstHeader(req.headers["x-kp-webhook-secret"]),
      remoteIsLoopback: deps.remoteIsLoopback,
    }) === "deny") {
      res.statusCode = 401;
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return true;
    }
    const drainKey = process.env.DRAIN_KEY;
    const headerKey = req.headers["x-drain-key"];
    const provided = new URL(url, "http://x").searchParams.get("key")
      ?? (Array.isArray(headerKey) ? headerKey[0] : headerKey);
    if (drainKey !== undefined && provided !== drainKey) {
      res.statusCode = 401;
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return true;
    }

    const connStr = process.env.NEON_DATABASE_URL;
    if (!connStr) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: "no NEON_DATABASE_URL" }));
      return true;
    }

    try {
      const rawBody = await readRawBody(req);
      const runner = neonRunner(connStr);
      await ensureCrawlerTable(runner);
      const result = await handleDrainPayload(runner, rawBody);
      res.end(JSON.stringify({ ok: true, recorded: result.recorded }));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: String((error as Error).message ?? error) }));
    }
    return true;
  }

  return false;
}
