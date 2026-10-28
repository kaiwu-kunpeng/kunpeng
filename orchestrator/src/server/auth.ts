import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../util/atomic-write.js";
import type { HostCeiling } from "./worker/host-permissions.js";

export interface AuthConfig {
  secret: string;
  accounts: AccountRecord[];
  webhookSecret?: string;
}

export interface AccountRecord {
  id?: string;
  username: string;
  salt: string;
  hash: string;
  profileId: string;
  role: "owner" | "member";
  hostCeiling?: HostCeiling;
  updatedAt: number;
  /** 最近一次改密码的时间；早于它签发的会话一律失效。老账号没有这个字段，行为不变。 */
  passwordChangedAt?: number;
  legacyConversationOwner?: string;
}

export interface AccountView {
  username: string;
  profileId: string;
  role: "owner" | "member";
  hostCeiling: HostCeiling;
}

export interface ParsedSession {
  accountId: string;
  profileId: string;
  issuedAt: number;
}

export interface LoginInput {
  username: string;
  password: string;
}

function isHostCeiling(value: unknown): value is HostCeiling {
  return value === "full" || value === "readonly" || value === "isolated";
}

export function accountHostCeiling(
  account: { hostCeiling?: unknown; role?: unknown } | null | undefined,
): HostCeiling {
  if (!account) return "isolated";
  // 未设上限：member 缺省 isolated（对话以免审批模式跑，缺省 full 等于把宿主 shell 交给协作者）；owner 与旧形态账号保持 full。
  if (account.hostCeiling === undefined) return account.role === "member" ? "isolated" : "full";
  return isHostCeiling(account.hostCeiling) ? account.hostCeiling : "isolated";
}

export function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

export function deriveAccountId(secret: string, salt: string): string {
  return createHmac("sha256", secret)
    .update(`kunpeng-account-id:v1:${salt}`)
    .digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

export function constantTimeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

export function verifyPassword(password: string, cfg: Pick<AccountRecord, "salt" | "hash">): boolean {
  return safeEqHex(hashPassword(password, cfg.salt), cfg.hash);
}

export function buildAuthConfig(
  username: string,
  password: string,
  deps: { salt: string; secret: string; now: number },
): AuthConfig {
  return {
    secret: deps.secret,
    accounts: [{
      id: deriveAccountId(deps.secret, deps.salt),
      username,
      salt: deps.salt,
      hash: hashPassword(password, deps.salt),
      profileId: "home",
      role: "owner",
      updatedAt: deps.now,
    }],
  };
}

export function bootstrapAuthConfig(deps: {
  randomHex: (bytes: number) => string;
  now: number;
  username?: string;
}): { config: AuthConfig; plainPassword: string } {
  const plainPassword = deps.randomHex(12);
  const config = buildAuthConfig(deps.username ?? "admin", plainPassword, {
    salt: deps.randomHex(16),
    secret: deps.randomHex(32),
    now: deps.now,
  });
  return { config, plainPassword };
}

export function signSession(accountId: string, profileId: string, secret: string, now: number): string {
  const payload = `v2.${accountId}.${profileId}.${now}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifySession(token: string, secret: string, now: number, maxAgeMs: number): ParsedSession | null {
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [version, accountId, profileId, issuedStr, sig] = parts;
  if (version !== "v2" || !accountId || !profileId || !issuedStr || !sig) return null;

  const expected = createHmac("sha256", secret).update(`v2.${accountId}.${profileId}.${issuedStr}`).digest("hex");
  if (!safeEqHex(sig, expected)) return null;

  const issued = Number(issuedStr);
  if (!Number.isFinite(issued) || now - issued > maxAgeMs || now - issued < 0) return null;
  return { accountId, profileId, issuedAt: issued };
}

export function findLoginAccount(cfg: AuthConfig, input: LoginInput): AccountRecord | null {
  const account = cfg.accounts.find((a) => a.username === input.username);
  if (!account) return null;
  return verifyPassword(input.password, account) ? account : null;
}

export interface AddAccountInput {
  username: string;
  password: string;
  profileId: string;
  role?: "owner" | "member";
  hostCeiling?: HostCeiling;
  salt: string;
  now: number;
}

export interface EditAccountInput {
  username: string;
  newUsername?: string;
  newPassword?: string;
  profileId?: string;
  role?: "owner" | "member";
  hostCeiling?: HostCeiling;
  salt?: string;
  now: number;
}

export function addAccount(cfg: AuthConfig, input: AddAccountInput): AuthConfig {
  const username = input.username.trim();
  if (!username) throw new Error("用户名不能为空");
  if (cfg.accounts.some((account) => account.username === username)) throw new Error(`账号 ${username} 已存在`);
  return {
    ...cfg,
    accounts: [
      ...cfg.accounts,
      {
        id: deriveAccountId(cfg.secret, input.salt),
        username,
        salt: input.salt,
        hash: hashPassword(input.password, input.salt),
        profileId: input.profileId,
        role: input.role ?? "member",
        ...(isHostCeiling(input.hostCeiling) ? { hostCeiling: input.hostCeiling } : {}),
        updatedAt: input.now,
      },
    ],
  };
}

export function editAccount(cfg: AuthConfig, input: EditAccountInput): AuthConfig {
  const username = input.username.trim();
  const account = cfg.accounts.find((candidate) => candidate.username === username);
  if (!account) throw new Error(`账号 ${username} 不存在`);

  const newUsername = input.newUsername === undefined ? account.username : input.newUsername.trim();
  if (!newUsername) throw new Error("用户名不能为空");
  if (newUsername !== account.username && cfg.accounts.some((candidate) => candidate.username === newUsername)) {
    throw new Error(`账号 ${newUsername} 已存在`);
  }

  const nextRole = input.role ?? account.role;
  if (account.role === "owner" && nextRole === "member") {
    const ownerCount = cfg.accounts.filter((candidate) => candidate.role === "owner").length;
    if (ownerCount <= 1) throw new Error("不能降级最后一个 owner");
  }

  const passwordPatch = input.newPassword === undefined
    ? {}
    : (() => {
        if (!input.salt) throw new Error("重置密码缺少 salt");
        return {
          salt: input.salt,
          hash: hashPassword(input.newPassword, input.salt),
          passwordChangedAt: input.now,
        };
      })();
  const hostCeilingPatch = isHostCeiling(input.hostCeiling)
    ? { hostCeiling: input.hostCeiling }
    : {};

  return {
    ...cfg,
    accounts: cfg.accounts.map((candidate) => {
      if (candidate.username !== account.username) return candidate;
      return {
        ...candidate,
        ...passwordPatch,
        ...hostCeilingPatch,
        username: newUsername,
        profileId: input.profileId ?? candidate.profileId,
        role: nextRole,
        updatedAt: input.now,
      };
    }),
  };
}

export function deleteAccount(cfg: AuthConfig, usernameInput: string): AuthConfig {
  const username = usernameInput.trim();
  const account = cfg.accounts.find((candidate) => candidate.username === username);
  if (!account) throw new Error(`账号 ${username} 不存在`);

  if (account.role === "owner") {
    const ownerCount = cfg.accounts.filter((candidate) => candidate.role === "owner").length;
    if (ownerCount <= 1) throw new Error("不能删除最后一个 owner");
  }

  return {
    ...cfg,
    accounts: cfg.accounts.filter((candidate) => candidate.username !== username),
  };
}

export function listAccounts(cfg: AuthConfig): AccountView[] {
  return cfg.accounts.map((account) => ({
    username: account.username,
    profileId: account.profileId,
    role: account.role,
    hostCeiling: accountHostCeiling(account),
  }));
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;

  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const rawValue = part.slice(i + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(rawValue);
    } catch {
      out[key] = rawValue;
    }
  }
  return out;
}

function authPath(stateDir: string): string {
  return join(stateDir, "auth.json");
}

function isAuthConfig(value: unknown): value is AuthConfig {
  if (!value || typeof value !== "object") return false;
  const cfg = value as { secret?: unknown; accounts?: unknown; webhookSecret?: unknown };
  return typeof cfg.secret === "string" && cfg.secret.length > 0
    && (cfg.webhookSecret === undefined || typeof cfg.webhookSecret === "string")
    && Array.isArray(cfg.accounts)
    && cfg.accounts.every(isAccountRecord);
}

function isAccountRecord(value: unknown): value is AccountRecord {
  if (!value || typeof value !== "object") return false;
  const account = value as Partial<Record<keyof AccountRecord, unknown>>;
  return typeof account.username === "string" && account.username.length > 0
    && (account.id === undefined || (typeof account.id === "string" && /^[0-9a-f]{16,}$/.test(account.id)))
    && typeof account.salt === "string" && account.salt.length > 0
    && typeof account.hash === "string" && account.hash.length > 0
    && typeof account.profileId === "string" && account.profileId.length > 0
    && (account.role === "owner" || account.role === "member")
    && (account.hostCeiling === undefined || isHostCeiling(account.hostCeiling))
    && typeof account.updatedAt === "number" && Number.isFinite(account.updatedAt)
    && (account.legacyConversationOwner === undefined
      || (typeof account.legacyConversationOwner === "string" && account.legacyConversationOwner.length > 0));
}

function ensureAccountIds(cfg: AuthConfig): AuthConfig {
  let changed = false;
  const accounts = cfg.accounts.map((account) => {
    if (account.id) return account;
    changed = true;
    return {
      ...account,
      id: deriveAccountId(cfg.secret, account.salt),
      legacyConversationOwner: account.username,
    };
  });
  return changed ? { ...cfg, accounts } : cfg;
}

function migrateLegacyAuthConfig(value: unknown): AuthConfig | null {
  if (!value || typeof value !== "object") return null;
  const cfg = value as {
    username?: unknown;
    salt?: unknown;
    hash?: unknown;
    secret?: unknown;
    updatedAt?: unknown;
  };
  if (
    typeof cfg.username === "string" && cfg.username.length > 0 &&
    typeof cfg.salt === "string" && cfg.salt.length > 0 &&
    typeof cfg.hash === "string" && cfg.hash.length > 0 &&
    typeof cfg.secret === "string" && cfg.secret.length > 0 &&
    typeof cfg.updatedAt === "number" && Number.isFinite(cfg.updatedAt)
  ) {
    return {
      secret: cfg.secret,
      accounts: [{
        username: cfg.username,
        salt: cfg.salt,
        hash: cfg.hash,
        profileId: "home",
        role: "owner",
        updatedAt: cfg.updatedAt,
      }],
    };
  }
  return null;
}

export async function readAuthConfig(stateDir: string): Promise<AuthConfig | null> {
  try {
    const raw = await readFile(authPath(stateDir), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (isAuthConfig(parsed)) return ensureAccountIds(parsed);
    const legacy = migrateLegacyAuthConfig(parsed);
    return legacy ? ensureAccountIds(legacy) : null;
  } catch {
    return null;
  }
}

export async function writeAuthConfig(stateDir: string, cfg: AuthConfig): Promise<void> {
  const path = authPath(stateDir);
  await writeFileAtomic(path, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
}

export type AuthAction =
  | "allow"
  | "forbidden-remote"
  | "login-page"
  | "do-login"
  | "do-logout"
  | "unauthorized-api"
  | "redirect-login"
  | "health-probe";

export function isLoopbackAddress(addr: string | undefined): boolean {
  if (addr === undefined) return false;
  return addr === "127.0.0.1" || addr === "::1" || addr.startsWith("::ffff:127.");
}

export function isTrustedLocalRequest(input: {
  remoteAddress?: string;
  forwardedFor?: string;
  forwardedProto?: string;
}): boolean {
  return isLoopbackAddress(input.remoteAddress) && !input.forwardedFor && !input.forwardedProto;
}

export function decideWebhookAuth(input: {
  configuredSecret?: string;
  headerSecret?: string;
  remoteIsLoopback: boolean;
}): "allow" | "deny" {
  if (input.configuredSecret) return constantTimeEq(input.headerSecret ?? "", input.configuredSecret) ? "allow" : "deny";
  return input.remoteIsLoopback ? "allow" : "deny";
}

/** 纯决策: 给定鉴权是否启用 + 请求信息, 返回该走哪条路。IO 由调用方做。 */
export function decideAuth(input: {
  authEnabled: boolean;
  path: string;
  method: string;
  cookieHeader?: string;
  secret: string;
  now: number;
  maxAgeMs: number;
  remoteIsLoopback?: boolean;
}): AuthAction {
  if (!input.authEnabled) return (input.remoteIsLoopback ?? true) ? "allow" : "forbidden-remote";
  if (input.path === "/api/login" && input.method === "POST") return "do-login";
  if (input.path === "/api/logout") return "do-logout";
  if (input.path === "/login" && input.method === "GET") return "login-page";

  const cookies = parseCookies(input.cookieHeader);
  const session = cookies.kp_session
    ? verifySession(cookies.kp_session, input.secret, input.now, input.maxAgeMs)
    : null;
  if (session) return "allow";
  // 外部监控 / 容器 HEALTHCHECK 免登录探活：只回 {ok}，细节仍需登录。
  if (input.path === "/healthz" && input.method === "GET") return "health-probe";

  return input.path.startsWith("/api/") ? "unauthorized-api" : "redirect-login";
}

export const SESSION_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

/** 构造会话 Set-Cookie(HttpOnly+SameSite=Lax, 本地无 https 不加 Secure; 过期传 expire=true 清除)。 */
export function sessionCookie(token: string, expire = false, secure = false): string {
  const base = `kp_session=${expire ? "" : token}; HttpOnly; SameSite=Lax; Path=/`;
  const maxAge = expire ? 0 : Math.floor(SESSION_MAX_AGE_MS / 1000);
  return `${base}; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

/** 极简登录页(内联, 无外链)。msg 给错误提示。 */
export function renderLoginPage(msg = ""): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>鲲鹏 · 登录</title>
<style>body{font-family:-apple-system,"PingFang SC",sans-serif;background:#fafbfc;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.box{background:#fff;border:1px solid #e7e9ee;border-radius:16px;padding:32px;width:320px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
h1{font-size:20px;margin:0 0 18px}input{width:100%;box-sizing:border-box;padding:10px 12px;margin:6px 0;border:1px solid #e7e9ee;border-radius:10px;font-size:14px}
button{width:100%;padding:11px;margin-top:10px;background:#2f6df0;color:#fff;border:0;border-radius:10px;font-size:15px;cursor:pointer}
.err{color:#d6446b;font-size:13px;min-height:18px;margin-top:6px}</style></head>
<body><div class="box"><h1>鲲鹏驾驶舱 · 登录</h1>
<input id="u" placeholder="用户名" autocomplete="username"><input id="p" type="password" placeholder="密码" autocomplete="current-password">
<button onclick="go()">登录</button><div class="err" id="e">${msg}</div>
<script>async function go(){var e=document.getElementById('e');e.textContent='';try{var r=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:document.getElementById('u').value,password:document.getElementById('p').value})});var j=await r.json();if(j.ok){location.href='/'}else{e.textContent=j.error||'登录失败'}}catch(x){e.textContent='网络错误'}}
document.getElementById('p').addEventListener('keydown',function(k){if(k.key==='Enter')go()})</script></div></body></html>`;
}
