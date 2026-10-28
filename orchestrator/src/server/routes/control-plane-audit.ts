import { readControlPlaneAudit } from "../../runtime/control-plane-audit.js";
import { registerModularRoute } from "./registry.js";

registerModularRoute({
  method: "GET",
  path: "/api/control-plane-audit",
  handle: (_req, res, url, context) => {
    res.setHeader("content-type", "application/json");
    try {
      const requested = Number(new URL(url, "http://localhost").searchParams.get("limit"));
      const limit = Number.isSafeInteger(requested) && requested > 0 ? requested : 100;
      res.end(JSON.stringify({ ok: true, changes: readControlPlaneAudit(context.stateDir, limit) }));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: String(error) }));
    }
  },
});
