import type { IncomingMessage, ServerResponse } from "node:http";
import { currentConversationOwner } from "../auth-context.js";
import { readJsonBody } from "../read-body.js";
import { handleLocalFsRoute, type LocalFsRouteRequest } from "../workspace-endpoints.js";
import type { AuthzRegistry } from "./authz-registry.js";
import type { OpQueue } from "./op-queue.js";
import type { LocalFsOp, LocalFsResult } from "./types.js";

const LOCALFS_PATH = /^\/api\/localfs\/(poll|result|enqueue|authorize)$/;
const LOCALFS_OP_KINDS = new Set<LocalFsOp["kind"]>(["read", "write", "list", "stat", "delete", "mkdir"]);

function isLocalFsOpKind(value: unknown): value is LocalFsOp["kind"] {
  return typeof value === "string" && LOCALFS_OP_KINDS.has(value as LocalFsOp["kind"]);
}

export async function handleLocalFsHttpRoute(
  method: string,
  url: string,
  req: IncomingMessage,
  res: ServerResponse,
  queue: OpQueue,
  authz: AuthzRegistry,
): Promise<boolean> {
  const path = url.split("?")[0];
  const match = LOCALFS_PATH.exec(path);
  if (!match) return false;

  res.setHeader("content-type", "application/json");
  const kind = match[1] as "poll" | "result" | "enqueue" | "authorize";
  const conv = new URL(url, "http://x").searchParams.get("conv")?.trim();
  if (!conv) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: "缺 conv" }));
    return true;
  }

  if (kind === "authorize") {
    if (method === "GET") {
      const entry = authz.get(conv);
      res.end(JSON.stringify(entry
        ? { ok: true, clientId: entry.clientId, origin: entry.origin, dirName: entry.dirName }
        : { ok: true, clientId: null }));
      return true;
    }
    if (method !== "POST") {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
      return true;
    }
    const body = await readJsonBody(req);
    authz.register({
      conv,
      clientId: typeof body.clientId === "string" ? body.clientId : "",
      dirName: typeof body.dirName === "string" ? body.dirName : "",
      origin: typeof body.origin === "string" ? body.origin : "",
      username: currentConversationOwner(),
      ts: Date.now(),
    });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  try {
    let routeReq: LocalFsRouteRequest;
    if (kind === "poll") {
      if (method !== "GET") {
        res.statusCode = 405;
        res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
        return true;
      }
      const clientId = new URL(url, "http://x").searchParams.get("clientId") ?? undefined;
      routeReq = { kind, conv, ...(clientId ? { clientId } : {}) };
    } else {
      if (method !== "POST") {
        res.statusCode = 405;
        res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
        return true;
      }
      const body = await readJsonBody(req);
      if (kind === "enqueue") {
        if (!isLocalFsOpKind(body.kind) || typeof body.path !== "string") {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: "localfs enqueue body invalid" }));
          return true;
        }
        const op: Omit<LocalFsOp, "opId" | "conv"> = { kind: body.kind, path: body.path };
        if (typeof body.content === "string") op.content = body.content;
        routeReq = { kind, conv, username: currentConversationOwner(), body: op };
      } else {
        if (typeof body.opId !== "string" || typeof body.ok !== "boolean") {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: "localfs result body invalid" }));
          return true;
        }
        const result: LocalFsResult = { opId: body.opId, ok: body.ok };
        if (typeof body.data === "string") result.data = body.data;
        if (typeof body.error === "string") result.error = body.error;
        const clientId = typeof body.clientId === "string" ? body.clientId : undefined;
        routeReq = { kind, conv, body: result, ...(clientId ? { clientId } : {}) };
      }
    }

    const result = await handleLocalFsRoute(queue, routeReq, authz);
    res.statusCode = result.status;
    if (result.status === 204) res.end();
    else res.end(JSON.stringify(result.json ?? { ok: true }));
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: String((error as Error).message ?? error) }));
  }
  return true;
}
