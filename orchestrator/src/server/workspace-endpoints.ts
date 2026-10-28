import type { AuthzRegistry } from "./localfs/authz-registry.js";
import { resolveNoListenerMs, type OpQueue } from "./localfs/op-queue.js";
import type { LocalFsOp, LocalFsResult } from "./localfs/types.js";

export { startSseHeartbeat } from "./chat-sse.js";
export * from "./workspace-driver-deps.js";
export * from "./upload-endpoints.js";
export * from "./chat-persistence.js";
export * from "./gate-endpoints.js";
export * from "./workspace-route.js";
export * from "./chat-stream.js";

export type LocalFsRouteRequest =
  | { kind: "poll"; conv: string; clientId?: string }
  | { kind: "enqueue"; conv: string; clientId?: string; username?: string; body: Omit<LocalFsOp, "opId" | "conv"> }
  | { kind: "result"; conv: string; clientId?: string; body: LocalFsResult };

export interface LocalFsRouteResponse {
  status: number;
  json?: unknown;
}

const legacyLocalFsAuthz: AuthzRegistry = {
  register: () => {},
  get: () => undefined,
  matches: () => true,
  clear: () => {},
};

export async function handleLocalFsRoute(
  queue: OpQueue,
  req: LocalFsRouteRequest,
  authz: AuthzRegistry = legacyLocalFsAuthz,
): Promise<LocalFsRouteResponse> {
  if (req.kind === "poll") {
    const owner = authz.get(req.conv);
    if (!authz.matches(req.conv, req.clientId ?? "")) {
      return {
        status: 403,
        json: {
          ok: false,
          reason: "not-owner",
          ...(owner ? { origin: owner.origin, dirName: owner.dirName } : {}),
        },
      };
    }
    queue.markPolled?.(req.conv);
    const op = queue.take(req.conv);
    return op ? { status: 200, json: op } : { status: 204 };
  }

  if (req.kind === "enqueue") {
    const owner = authz.get(req.conv);
    const legacyCallerAuthorized = req.username === undefined
      && req.clientId === undefined
      && authz.matches(req.conv, "");
    if (owner && owner.username !== (req.username ?? "") && !legacyCallerAuthorized) {
      return {
        status: 403,
        json: {
          ok: false,
          reason: "not-owner",
          ...(owner ? { origin: owner.origin, dirName: owner.dirName } : {}),
        },
      };
    }
    // 默认 30s 会撞上浏览器后台标签页的定时器节流(轮询间隔被拉到 ≥60s),
    // 用户切走标签页/锁屏时所有 op 全部超时。放宽到 120s 覆盖节流窗口。
    try {
      // Poll-aware queues resolve the grace period from their live authorization
      // state. Keep the old explicit 8s argument only for legacy queue adapters
      // that predate markPolled and therefore cannot provide that state.
      const result = typeof queue.markPolled === "function"
        ? await queue.enqueue(req.conv, req.body, 120_000)
        : await queue.enqueue(req.conv, req.body, 120_000, resolveNoListenerMs(false));
      return { status: 200, json: result };
    } catch (e) {
      return {
        status: 200,
        json: { opId: "", ok: false, error: (e as Error).message },
      };
    }
  }

  if (!authz.matches(req.conv, req.clientId ?? "")) {
    return { status: 403, json: { ok: false, reason: "not-owner" } };
  }

  return queue.resolve(req.body.opId, req.body, { conv: req.conv })
    ? { status: 200, json: { ok: true } }
    : { status: 404, json: { ok: false, error: "localfs op not found" } };
}
