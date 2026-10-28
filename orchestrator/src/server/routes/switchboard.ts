// /api/switchboard/* 路由组（从 http.ts startDashboard 巨函数析出）。
// 返回 true 表示已处理该请求；false 表示非本组路由，交回主分发继续。
import type { IncomingMessage, ServerResponse } from "node:http";
import { watch } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { newMessage, SwitchboardStore } from "../../switchboard/store.js";
import { PresenceStore } from "../../switchboard/presence.js";
import { findEscalations } from "../../switchboard/escalation.js";
import { sseFrame, sseHeaders } from "../sse.js";
import { readJsonBody } from "../read-body.js";

export async function handleSwitchboardRoute(
  method: string,
  url: string,
  req: IncomingMessage,
  res: ServerResponse,
  deps: { stateDir: string },
): Promise<boolean> {
  const path = url.split("?")[0];
  const base = deps.stateDir;

  if (method === "GET" && path === "/api/switchboard/stream") {
    const headers = sseHeaders();
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.statusCode = 200;
    try {
      res.write(sseFrame("ready"));
    } catch {
      return true;
    }
    let debounce: NodeJS.Timeout | undefined;
    const watchers: { close(): void }[] = [];
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (timer) clearInterval(timer);
      if (debounce) clearTimeout(debounce);
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // 忽略已关闭 watcher。
        }
      }
    };
    const writeFrame = (frame: string) => {
      if (closed) return;
      try {
        res.write(frame);
      } catch {
        cleanup();
      }
    };
    const emit = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => { writeFrame(sseFrame("changed")); }, 300);
    };
    for (const sub of ["switchboard", "presence"]) {
      try {
        watchers.push(watch(join(base, sub), { persistent: false }, emit));
      } catch {
        // 目录可能还没建，忽略。
      }
    }
    const timer = setInterval(() => { writeFrame(": hb\n\n"); }, 25000);
    req.on("close", cleanup);
    req.on("error", cleanup);
    return true;
  }

  if (method === "POST" && url.startsWith("/api/switchboard/send")) {
    res.setHeader("content-type", "application/json");
    try {
      const reqBody = await readJsonBody(req);
      const from = String(reqBody.from || "http");
      const to = String(reqBody.to ?? "");
      const topic = reqBody.topic ? String(reqBody.topic) : undefined;
      const messageBody = String(reqBody.body ?? "");
      if (!to || !messageBody) {
        res.end(JSON.stringify({ ok: false, error: "缺 to 或 body" }));
        return true;
      }
      const store = new SwitchboardStore(join(base, "switchboard"));
      const msg = newMessage(
        { from, to, topic, body: messageBody, urgent: Boolean(reqBody.urgent) },
        { now: Date.now, id: () => `msg-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}` },
      );
      await store.append(msg);
      res.end(JSON.stringify({ ok: true, id: msg.id }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return true;
  }

  if (method === "GET" && url.startsWith("/api/switchboard/inbox")) {
    res.setHeader("content-type", "application/json");
    try {
      const q = new URL(url, "http://x").searchParams;
      const as = String(q.get("as") ?? "main");
      const unread = q.get("unread");
      const unreadOnly = unread === "1" || unread === "true";
      const peek = q.get("peek") === "1";
      const store = new SwitchboardStore(join(base, "switchboard"));
      const messages = await store.inbox(as, { unreadOnly });
      if (!peek) {
        for (const message of messages) {
          if (message.read === false) await store.markRead(message.id);
        }
      }
      res.end(JSON.stringify({ ok: true, messages }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return true;
  }

  if (method === "GET" && url.startsWith("/api/switchboard/presence")) {
    res.setHeader("content-type", "application/json");
    try {
      const online = await new PresenceStore(join(base, "presence")).online(Date.now());
      res.end(JSON.stringify({ ok: true, online }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return true;
  }

  if (method === "GET" && url.startsWith("/api/switchboard/escalations")) {
    res.setHeader("content-type", "application/json");
    try {
      const store = new SwitchboardStore(join(base, "switchboard"));
      const online = await new PresenceStore(join(base, "presence")).online(Date.now());
      const escalations = findEscalations({ messages: await store.list(), online, now: Date.now() });
      res.end(JSON.stringify({ ok: true, escalations }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return true;
  }

  return false;
}
