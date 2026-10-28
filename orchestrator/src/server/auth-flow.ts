import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { appendAudit } from "./audit.js";
import { decideAuth, findLoginAccount, readAuthConfig, renderLoginPage, sessionCookie, signSession } from "./auth.js";
import { collectHealthz } from "./healthz.js";
import { createLoginLimiter, resolveLoginClientIp } from "./login-limiter.js";
import { readJsonBody } from "./read-body.js";

const loginLimiters = new Map<string, ReturnType<typeof createLoginLimiter>>();

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function handleAuthAction(
  action: ReturnType<typeof decideAuth>,
  req: IncomingMessage,
  res: ServerResponse,
  deps: { stateDir: string; authCfg: Awaited<ReturnType<typeof readAuthConfig>> },
): Promise<boolean> {
  if (action === "forbidden-remote") {
    res.statusCode = 403;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "远程访问需配置 auth.json 鉴权" }));
    return true;
  }
  if (action === "login-page") {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "no-cache");
    res.end(renderLoginPage());
    return true;
  }
  if (action === "do-login") {
    res.setHeader("content-type", "application/json");
    try {
      const body = await readJsonBody(req);
      if (typeof body.username !== "string" || typeof body.password !== "string") {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: "请求无效" }));
        return true;
      }
      let loginLimiter = loginLimiters.get(deps.stateDir);
      if (!loginLimiter) {
        loginLimiter = createLoginLimiter({ persistPath: join(deps.stateDir, "login-limiter.json") });
        loginLimiters.set(deps.stateDir, loginLimiter);
      }
      const key = `${body.username}|${resolveLoginClientIp({
        remoteAddress: req.socket.remoteAddress,
        cfConnectingIp: firstHeader(req.headers["cf-connecting-ip"]),
      })}`;
      const now = Date.now();
      const limit = loginLimiter.check(key, now);
      if (!limit.allowed) {
        res.statusCode = 429;
        if (limit.retryAfterMs !== undefined) res.setHeader("retry-after", String(Math.ceil(limit.retryAfterMs / 1000)));
        await appendAudit(deps.stateDir, { at: now, action: "login-locked", user: body.username, status: "locked" });
        res.end(JSON.stringify({ ok: false, error: "尝试过多，稍后再试" }));
        return true;
      }
      const account = deps.authCfg ? findLoginAccount(deps.authCfg, { username: body.username, password: body.password }) : null;
      if (deps.authCfg && account) {
        if (!account.id) throw new Error("账号缺少 accountId");
        loginLimiter.recordSuccess(key);
        await appendAudit(deps.stateDir, { at: now, action: "login-ok", user: account.username, status: "ok" });
        res.setHeader("set-cookie", sessionCookie(
          signSession(account.id, account.profileId, deps.authCfg.secret, Date.now()),
          false,
          firstHeader(req.headers["x-forwarded-proto"]) === "https",
        ));
        res.end(JSON.stringify({ ok: true }));
      } else {
        loginLimiter.recordFail(key, now);
        await appendAudit(deps.stateDir, { at: now, action: "login-fail", user: body.username, status: "fail" });
        res.statusCode = 401;
        res.end(JSON.stringify({ ok: false, error: "用户名或密码错误" }));
      }
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: "请求无效" }));
    }
    return true;
  }
  if (action === "do-logout") {
    await appendAudit(deps.stateDir, { at: Date.now(), action: "logout" });
    res.setHeader("set-cookie", sessionCookie("", true));
    res.statusCode = 302;
    res.setHeader("location", "/login");
    res.end();
    return true;
  }
  if (action === "health-probe") {
    const report = await collectHealthz({ stateDir: deps.stateDir });
    res.statusCode = report.ok ? 200 : 503;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: report.ok }));
    return true;
  }
  if (action === "unauthorized-api") {
    res.statusCode = 401;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "未登录" }));
    return true;
  }
  if (action === "redirect-login") {
    res.statusCode = 302;
    res.setHeader("location", "/login");
    res.end();
    return true;
  }
  return false;
}
