import { join } from "node:path";
import { InboxDeferStore } from "../inbox-defer-store.js";
import { InboxDismissStore } from "../inbox-dismiss-store.js";
import { InboxSeenStore } from "../inbox-seen-store.js";
import { readJsonBody } from "../read-body.js";
import { registerModularRoute, type RouteContext } from "./registry.js";

registerModularRoute({
  method: "POST",
  path: "/api/inbox/defer",
  handle: async (req, res, _url, context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    let until = Date.now() + 24 * 3600e3;
    try {
      const body = await readJsonBody(req);
      const keys = Array.isArray(body.keys)
        ? body.keys.filter((key): key is string =>
          typeof key === "string" && /^(merge|proposal|release|connector|ops|failed|blocked|alert|budget):.+$/.test(key))
        : [];
      const hours = typeof body.hours === "number" && Number.isFinite(body.hours)
        ? Math.max(1, Math.min(168, Math.trunc(body.hours)))
        : 24;
      until = Date.now() + hours * 3600e3;
      await new InboxDeferStore(join(context.stateDir, "inbox-deferred.json")).markDeferred(keys, until);
    } catch {
      // Read/unmarshal/write failures must never interrupt the inbox experience.
    }
    res.end(JSON.stringify({ ok: true, until }));
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/inbox/seen",
  handle: async (req, res, _url, context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    try {
      const body = await readJsonBody(req);
      const keys = Array.isArray(body.keys)
        ? body.keys.filter((key): key is string => typeof key === "string" && key.length > 0)
        : [];
      await new InboxSeenStore(join(context.stateDir, "inbox-seen.json")).markSeen(keys);
    } catch {
      // Read/unmarshal/write failures must never interrupt the inbox experience.
    }
    res.end(JSON.stringify({ ok: true }));
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/inbox/dismiss",
  handle: async (req, res, _url, context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    try {
      const body = await readJsonBody(req);
      const keys = Array.isArray(body.keys)
        ? body.keys.filter((key): key is string =>
          typeof key === "string"
          && (key.startsWith("failed:")
            || key.startsWith("blocked:")
            || key.startsWith("alert:")
            || key.startsWith("budget:")))
        : [];
      await new InboxDismissStore(join(context.stateDir, "inbox-dismissed.json")).markDismissed(keys);
    } catch {
      // Read/unmarshal/write failures must never interrupt the inbox experience.
    }
    res.end(JSON.stringify({ ok: true }));
    return;
  },
});
