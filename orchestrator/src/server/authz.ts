import type { AccountRecord, ParsedSession } from "./auth.js";

export type AuthzDecision =
  | { ok: true; accountId: string; username: string; profileId: string; role: "owner" | "member" }
  | { ok: false; status: 401 | 403 };

export type Capability = "read" | "chat" | "dispatch" | "merge" | "terminal" | "localfs" | "accounts" | "admin";

export interface AuthzPolicy {
  roles: Partial<Record<"owner" | "member", readonly Capability[]>>;
}

const ACCOUNT_ADMIN_PREFIX = "/api/accounts";

export const ROUTE_CAPABILITY_TABLE: Readonly<Record<string, Capability>> = {
  "POST /api/abandon-flow": "dispatch",
  "GET /api/accounts": "accounts",
  "POST /api/accounts": "accounts",
  "PATCH /api/accounts": "accounts",
  "DELETE /api/accounts": "accounts",
  "POST /api/approve": "merge",
  "POST /api/approve-connector": "merge",
  "GET /api/arch-graph": "read",
  "GET /api/attention": "read",
  "POST /api/auth/change-password": "accounts",
  "POST /api/autopilot": "merge",
  "POST /api/confirm-release": "merge",
  "GET /api/control-plane-audit": "read",
  "POST /api/design-advise": "dispatch",
  "POST /api/design-codegen": "dispatch",
  "POST /api/design-generate": "dispatch",
  "POST /api/design-loop": "dispatch",
  "GET /api/design-presets": "read",
  "POST /api/design-preview": "dispatch",
  "POST /api/distill-skill": "dispatch",
  "POST /api/edit-proposal": "dispatch",
  "GET /api/escape-rate": "read",
  "GET /api/eval-report": "read",
  "GET /api/evidence": "read",
  // 写审查意见会驱动流重做（resume 时注入），与 /api/resume 同级。
  "POST /api/feedback": "dispatch",
  "GET /api/file": "read",
  "GET /api/files": "read",
  "GET /api/flow-log": "read",
  "POST /api/gate-comments": "chat",
  "GET /api/gate-comments": "read",
  "POST /api/gate-comments/sendback": "merge",
  "GET /api/gate-diff": "read",
  "GET /api/gates/diagnosis": "read",
  "GET /api/gates/diff": "read",
  "POST /api/gates/discard": "merge",
  "POST /api/gc": "admin",
  "POST /api/inbox/defer": "merge",
  "POST /api/inbox/dismiss": "chat",
  "POST /api/inbox/seen": "chat",
  "GET /api/kb": "read",
  "POST /api/knowledge-ask": "chat",
  "POST /api/knowledge-capture": "chat",
  "POST /api/knowledge-delete": "chat",
  "POST /api/knowledge-distill-card": "chat",
  "POST /api/knowledge-edit": "chat",
  "POST /api/knowledge-promote": "chat",
  "GET /api/knowledge-resurface": "read",
  "GET /api/knowledge-search": "read",
  "POST /api/knowledge-synthesize": "chat",
  "GET /api/knowledge-tagcloud": "read",
  "GET /api/library": "read",
  "POST /api/library/scan": "dispatch",
  "POST /api/loop-lever-to-task": "dispatch",
  "POST /api/loop-run": "dispatch",
  "POST /api/loop-weakpoints": "dispatch",
  "POST /api/merge": "merge",
  "POST /api/ops-gate-decide": "merge",
  "POST /api/ops-gates": "merge",
  "GET /api/ops-gates": "read",
  "GET /api/ops/actions": "read",
  "POST /api/ops/run": "dispatch",
  "POST /api/pause": "dispatch",
  "GET /api/perf-health": "read",
  "GET /api/pills": "read",
  "POST /api/pills": "dispatch",
  "POST /api/plan": "dispatch",
  "GET /api/plan-file": "read",
  "GET /api/plans": "read",
  "POST /api/product-answer": "dispatch",
  "POST /api/product-start": "dispatch",
  "POST /api/product-to-spec": "dispatch",
  "POST /api/product/accept": "dispatch",
  "POST /api/product/activate": "dispatch",
  "POST /api/product/buildspec/save": "dispatch",
  "POST /api/product/checkup": "dispatch",
  "POST /api/product/copy-ref": "dispatch",
  "POST /api/product/delete": "admin",
  "POST /api/product/design/run": "dispatch",
  "GET /api/product/env": "read",
  "POST /api/product/env/init": "dispatch",
  "GET /api/product/list": "read",
  "POST /api/product/new": "dispatch",
  "POST /api/product/pick-task": "dispatch",
  "GET /api/product/plan": "read",
  "GET /api/product/preview": "read",
  "POST /api/product/preview/start": "dispatch",
  "POST /api/product/preview/stop": "dispatch",
  "POST /api/product/publish": "admin",
  "POST /api/product/purge": "admin",
  "POST /api/product/qa": "dispatch",
  "POST /api/product/restore": "admin",
  "POST /api/product/rollback": "admin",
  "POST /api/product/snapshot": "dispatch",
  "POST /api/product/spec/save": "dispatch",
  "GET /api/product/state": "read",
  "GET /api/product/templates": "read",
  "POST /api/product/validate": "dispatch",
  "POST /api/product/ws-restore": "admin",
  "GET /api/projects": "read",
  "GET /api/proposal-body": "read",
  "GET /api/push/pending": "read",
  "POST /api/push/subscribe": "admin",
  "POST /api/push/unsubscribe": "admin",
  "GET /api/push/vapid-key": "read",
  "POST /api/register-project": "admin",
  "POST /api/reject": "merge",
  "POST /api/rerun": "dispatch",
  "POST /api/resume": "dispatch",
  "POST /api/run": "dispatch",
  "POST /api/save-plan": "dispatch",
  "POST /api/select-design": "dispatch",
  "POST /api/settings/backends": "admin",
  "GET /api/settings/notify": "admin",
  "POST /api/settings/notify": "admin",
  "POST /api/solutions/apply": "dispatch",
  "GET /api/state": "read",
  "POST /api/state": "dispatch",
  "POST /api/stop": "dispatch",
  "GET /api/taskboard": "read",
  "POST /api/taskboard/claim": "dispatch",
  "POST /api/taskboard/complete": "dispatch",
  "POST /api/taskboard/create": "dispatch",
  "POST /api/taskboard/reap": "dispatch",
  "GET /api/tasks": "read",
  "POST /api/tasks": "dispatch",
  "POST /api/tasks/transition": "dispatch",
  "GET /api/today": "read",
  "GET /api/vendor/pdfjs": "read",
  "GET /api/version": "read",
  "GET /api/view": "read",
  "POST /api/worker/exec": "terminal",
  "POST /api/worker/fs": "terminal",
  "GET /api/worker/machines": "read",
  "POST /api/worker/revoke": "terminal",
  "GET /api/worker/revoked": "read",
  "POST /api/worker/token": "terminal",
  "POST /api/worker/unrevoke": "terminal",
  "GET /doc": "read",
  "GET /healthz": "read",
  "GET /help": "read",
  "GET /plugins": "read",
  // —— 注册表之外的内联端点（方法无关键）——
  "/api/login": "read",
  "/api/logout": "read",
  // beacon 在会话鉴权之前由 serveBeaconIngest 处理（HMAC token 自证），这一项对真实请求不生效，仅供完整性。
  "/api/beacon": "read",
  "/api/pty": "terminal",
  "/kpworker": "terminal",
  "/api/worker/connect": "terminal",
  "/api/localfs": "localfs",
  "/api/localfs/enqueue": "localfs",
  "/api/dispatch": "dispatch",
  "/api/drain": "admin",
  "/api/chat": "chat",
  "/api/conversations": "chat",
  "/api/gate": "merge",
  // 保留未传方法的 state 浏览调用；显式 POST 仍优先命中 dispatch。
  "/api/state": "read",
};

// 模式表先于前缀表：/api/workspace/:id/pty(/sessions) 是常驻 shell，必须判 terminal，
// 否则会被下面 "/api/workspace/" → chat 的前缀整族吞掉，仅有 chat 的 member 就能拿到终端。
export const ROUTE_CAPABILITY_PATTERNS: readonly (readonly [RegExp, Capability])[] = [
  [/^\/api\/workspace\/[^/]+\/pty(?:\/|$)/, "terminal"],
];

// 仅动态路由家族，按最长前缀优先排列。
export const ROUTE_CAPABILITY_PREFIXES: readonly (readonly [string, Capability])[] = [
  ["/api/conversations/", "chat"],
  ["/api/gate-comments/", "merge"],
  ["/api/knowledge-", "chat"],
  ["/api/workspace/", "chat"],
  ["/api/taskboard/", "dispatch"],
  ["/api/accounts/", "accounts"],
  ["/api/settings/", "admin"],
  ["/api/localfs/", "localfs"],
  ["/api/product/", "dispatch"],
  ["/api/worker/", "terminal"],
  ["/api/design-", "dispatch"],
  ["/api/chat/", "chat"],
  ["/api/push/", "read"],
  ["/kpworker/", "terminal"],
  ["/api/pty/", "terminal"],
];

const CAPABILITY_ORDER: readonly Capability[] = ["read", "chat", "dispatch", "merge", "localfs", "terminal", "accounts", "admin"];

export function capabilityForRoute(path: string, method?: string): Capability | undefined {
  path = path.split("?")[0];
  if (!path.startsWith("/api/") && !path.startsWith("/kpworker")) return "read" as const;

  if (method !== undefined) {
    const exact = ROUTE_CAPABILITY_TABLE[`${method.toUpperCase()} ${path}`];
    if (exact !== undefined) return exact;
  }
  const methodIndependent = ROUTE_CAPABILITY_TABLE[path];
  if (methodIndependent !== undefined) return methodIndependent;

  if (method === undefined) {
    let strictest: Capability | undefined;
    for (const [route, capability] of Object.entries(ROUTE_CAPABILITY_TABLE)) {
      const separator = route.indexOf(" ");
      if (separator === -1 || route.slice(separator + 1) !== path) continue;
      if (strictest === undefined || CAPABILITY_ORDER.indexOf(capability) > CAPABILITY_ORDER.indexOf(strictest)) {
        strictest = capability;
      }
    }
    if (strictest !== undefined) return strictest;
  }

  for (const [pattern, capability] of ROUTE_CAPABILITY_PATTERNS) {
    if (pattern.test(path)) return capability;
  }

  for (const [prefix, capability] of ROUTE_CAPABILITY_PREFIXES) {
    if (path.startsWith(prefix)) return capability;
  }
  return undefined;
}

export function capabilityForPath(path: string, method?: string): Capability | undefined {
  return capabilityForRoute(path, method);
}

export const RESTRICTED_POLICY: AuthzPolicy = {
  roles: {
    owner: ["read", "chat", "dispatch", "merge", "terminal", "localfs", "accounts", "admin"],
    member: ["read", "chat", "dispatch"],
  },
};

/** 改密码之前签发的会话作废（只看 passwordChangedAt，改角色、改 hostCeiling 不踢人）。 */
function isRevokedByPasswordChange(session: ParsedSession, account: AccountRecord): boolean {
  return typeof account.passwordChangedAt === "number" && session.issuedAt < account.passwordChangedAt;
}

export function authorizeRequest(
  session: ParsedSession,
  accounts: AccountRecord[],
  path: string,
  policy?: AuthzPolicy,
  method?: string,
): AuthzDecision {
  const account = accounts.find((candidate) => candidate.id === session.accountId);
  if (!account) return { ok: false, status: 401 };
  if (account.profileId !== session.profileId) return { ok: false, status: 401 };
  if (isRevokedByPasswordChange(session, account)) return { ok: false, status: 401 };

  const allow = (): AuthzDecision => ({
    ok: true,
    accountId: session.accountId,
    username: account.username,
    profileId: account.profileId,
    role: account.role,
  });

  if (policy) {
    const capabilities = policy.roles[account.role];
    if (capabilities === undefined) {
      // 未列出该角色 → 走老行为（除 accounts 外放行）。
      if (path.startsWith(ACCOUNT_ADMIN_PREFIX) && account.role !== "owner") return { ok: false, status: 403 };
      return allow();
    }
    const required = capabilityForRoute(path, method);
    if (required === undefined) return { ok: false, status: 403 };
    if (!capabilities.includes(required)) return { ok: false, status: 403 };
    return allow();
  }

  if (path.startsWith(ACCOUNT_ADMIN_PREFIX) && account.role !== "owner") return { ok: false, status: 403 };
  return allow();
}

export type AuthzLayer = "account" | "profile" | "unmapped-route" | "capability" | "legacy-accounts";

export function explainAuthzDenial(
  session: ParsedSession,
  accounts: AccountRecord[],
  path: string,
  policy?: AuthzPolicy,
  method?: string,
): { layer: AuthzLayer; detail: string } | null {
  const account = accounts.find((candidate) => candidate.id === session.accountId);
  if (!account) return { layer: "account", detail: `账号不存在 ${session.accountId}` };
  if (account.profileId !== session.profileId) {
    return { layer: "profile", detail: `profile 不符：会话 ${session.profileId}，账号 ${account.profileId}` };
  }
  if (isRevokedByPasswordChange(session, account)) return { layer: "account", detail: "密码已修改，此前签发的会话已失效" };

  const capabilities = policy?.roles[account.role];
  if (capabilities !== undefined) {
    const required = capabilityForRoute(path, method);
    const route = method === undefined ? path : `${method.toUpperCase()} ${path}`;
    if (required === undefined) return { layer: "unmapped-route", detail: `未登记路由 ${route}` };
    if (!capabilities.includes(required)) {
      return { layer: "capability", detail: `${account.role} 缺少能力 ${required}（${route}）` };
    }
    return null;
  }

  if (path.startsWith(ACCOUNT_ADMIN_PREFIX) && account.role !== "owner") {
    return { layer: "legacy-accounts", detail: `${account.role} 无权访问账号管理 ${path}，需 owner` };
  }
  return null;
}

/** 默认启用受限能力表；仅 open / legacy / off / 0 显式回到老行为，其余值均为 RESTRICTED_POLICY。 */
export function resolveAuthzPolicy(env: NodeJS.ProcessEnv = process.env): AuthzPolicy | undefined {
  const raw = (env.KUNPENG_AUTHZ_POLICY ?? "").trim().toLowerCase();
  return ["open", "legacy", "off", "0"].includes(raw) ? undefined : RESTRICTED_POLICY;
}
