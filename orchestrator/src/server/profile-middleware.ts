import type { IncomingMessage, ServerResponse } from "node:http";
import { parseCookies, readAuthConfig, verifySession, SESSION_MAX_AGE_MS } from "./auth.js";
import type { AuthConfig } from "./auth.js";
import { authorizeRequest, explainAuthzDenial, resolveAuthzPolicy } from "./authz.js";
import type { AuthzDecision, AuthzLayer } from "./authz.js";

export type AuthGateResult = AuthzDecision;

export interface AuthGateDeps {
  stateDir: string;
  readAuthConfig?: (stateDir: string) => Promise<AuthConfig | null>;
  now?: () => number;
  maxAgeMs?: number;
}

function writeAuthError(
  res: ServerResponse,
  status: 401 | 403,
  explain?: { layer: AuthzLayer | "session"; detail: string } | null,
): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: false, error: status === 401 ? "未登录" : "无权限", ...explain }));
}

export function buildAuthGate(deps: AuthGateDeps) {
  return async (req: IncomingMessage, res: ServerResponse, path: string): Promise<AuthGateResult> => {
    const cfg = await (deps.readAuthConfig ?? readAuthConfig)(deps.stateDir);
    if (!cfg) {
      const decision: AuthGateResult = { ok: false, status: 401 };
      writeAuthError(res, decision.status, { layer: "session", detail: "未配置登录认证" });
      return decision;
    }

    const token = parseCookies(req.headers.cookie).kp_session;
    const session = token
      ? verifySession(token, cfg.secret, (deps.now ?? Date.now)(), deps.maxAgeMs ?? SESSION_MAX_AGE_MS)
      : null;
    if (!session) {
      const decision: AuthGateResult = { ok: false, status: 401 };
      writeAuthError(res, decision.status, { layer: "session", detail: "会话缺失、无效或已过期" });
      return decision;
    }

    const decision = authorizeRequest(session, cfg.accounts, path, resolveAuthzPolicy(), req.method);
    if (!decision.ok) {
      writeAuthError(res, decision.status, explainAuthzDenial(session, cfg.accounts, path, resolveAuthzPolicy(), req.method));
    }
    return decision;
  };
}
