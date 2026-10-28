import type { ServerResponse } from "node:http";
import {
  addSubscription,
  drainPending,
  publicKeyB64Url,
  removeSubscription,
} from "../push.js";
import { registerModularRoute } from "./registry.js";
import { readJsonObjectStrict } from "../read-body.js";

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(value));
}

registerModularRoute({
  method: "GET",
  path: "/api/push/vapid-key",
  handle: (_req, res) => {
    sendJson(res, 200, { ok: true, publicKey: publicKeyB64Url() });
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/push/subscribe",
  handle: async (req, res) => {
    try {
      const body = await readJsonObjectStrict(req);
      const added = await addSubscription(body.subscription ?? body);
      sendJson(res, 200, { ok: true, added, note: added ? "手机推送已开启" : "手机推送订阅已刷新" });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/push/unsubscribe",
  handle: async (req, res) => {
    try {
      const body = await readJsonObjectStrict(req);
      const removed = await removeSubscription(body.subscription ?? body);
      sendJson(res, 200, { ok: true, removed, note: "手机推送已关闭" });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
});

registerModularRoute({
  method: "GET",
  path: "/api/push/pending",
  handle: async (_req, res) => {
    sendJson(res, 200, { ok: true, notifications: await drainPending() });
  },
});
