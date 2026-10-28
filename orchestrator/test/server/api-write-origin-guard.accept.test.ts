import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDashboard } from "../../src/server/http.js";
import { hashPassword, writeAuthConfig, type AuthConfig } from "../../src/server/auth.js";
import { isCsrfSafe } from "../../src/server/workspace-route.js";

const REFUSED = "cross-site request refused";

let dir = "";
let base = "";
let host = "";
let cookie = "";
let server: { port: number; close: () => Promise<void> } | undefined;

async function send(method: string, path: string, headers: Record<string, string> = {}, body?: string) {
  const res = await fetch(`${base}${path}`, { method, headers: { cookie, ...headers }, body });
  const text = await res.text();
  const error = (() => {
    try {
      return String((JSON.parse(text) as { error?: unknown }).error ?? "");
    } catch {
      return "";
    }
  })();
  return { status: res.status, error };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "kp-origin-guard-"));
  const cfg: AuthConfig = {
    secret: "sec",
    webhookSecret: "whs",
    accounts: [{ username: "admin", salt: "s1", hash: hashPassword("pw", "s1"), profileId: "home", role: "owner", updatedAt: 1 }],
  };
  await writeAuthConfig(dir, cfg);
  server = await startDashboard({ port: 0, stateDir: dir });
  base = `http://127.0.0.1:${server.port}`;
  host = `127.0.0.1:${server.port}`;
  const login = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "cross-site", origin: "https://evil.example" },
    body: JSON.stringify({ username: "admin", password: "pw" }),
  });
  expect(login.status).toBe(200);
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  expect(cookie).toMatch(/^kp_session=/);
});

afterAll(async () => {
  await server?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("isCsrfSafe 只认同源（作者锁定）", () => {
  it("same-site 与 cross-site 拒；same-origin 与 none 放行", () => {
    expect(isCsrfSafe({ "sec-fetch-site": "same-site" }, "cockpit.example.com")).toBe(false);
    expect(isCsrfSafe({ "sec-fetch-site": "cross-site" }, "cockpit.example.com")).toBe(false);
    expect(isCsrfSafe({ "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" }, "cockpit.example.com")).toBe(true);
    expect(isCsrfSafe({ "sec-fetch-site": "none", "sec-fetch-mode": "cors" }, "cockpit.example.com")).toBe(true);
  });
});

describe("所有 /api 写接口在鉴权后统一校验来源（作者锁定，真 server 真请求）", () => {
  const seen = (headers: Record<string, string>) =>
    send("POST", "/api/inbox/seen", { "content-type": "application/json", ...headers }, JSON.stringify({ keys: ["k1"] }));

  it("Sec-Fetch-Site: same-site 的 POST → 403", async () => {
    expect(await seen({ "sec-fetch-site": "same-site", "sec-fetch-mode": "cors", origin: "https://sibling.example.com" }))
      .toEqual({ status: 403, error: REFUSED });
  });

  it("Sec-Fetch-Site: cross-site 的 POST → 403", async () => {
    expect(await seen({ "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors" })).toEqual({ status: 403, error: REFUSED });
  });

  it("没有 Sec-Fetch-Site、Origin 跨主机的 POST → 403", async () => {
    expect(await seen({ origin: "https://evil.example" })).toEqual({ status: 403, error: REFUSED });
  });

  it("DELETE / PATCH 也一样被拦", async () => {
    const del = await send("DELETE", "/api/accounts?username=nobody", { "sec-fetch-site": "same-site" });
    expect(del).toEqual({ status: 403, error: REFUSED });
    const patch = await send("PATCH", "/api/accounts", { "content-type": "application/json", "sec-fetch-site": "same-site" }, "{}");
    expect(patch).toEqual({ status: 403, error: REFUSED });
  });

  it("same-origin、none、同主机 Origin 的 POST 放行", async () => {
    expect(await seen({ "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", origin: `http://${host}` })).toEqual({ status: 200, error: "" });
    expect(await seen({ "sec-fetch-site": "none", "sec-fetch-mode": "cors" })).toEqual({ status: 200, error: "" });
    expect(await seen({ origin: `http://${host}` })).toEqual({ status: 200, error: "" });
  });

  it("不带 Origin / Referer / Sec-Fetch-Site 的 CLI 请求放行", async () => {
    expect(await seen({})).toEqual({ status: 200, error: "" });
  });

  it("GET 不受影响", async () => {
    const r = await send("GET", "/api/state", { "sec-fetch-site": "cross-site", origin: "https://evil.example" });
    expect(r.status).toBe(200);
  });

  it("鉴权前处理的 webhook 不受影响", async () => {
    const r = await send(
      "POST",
      "/api/dispatch",
      { "content-type": "application/json", "sec-fetch-site": "cross-site", origin: "https://evil.example", "x-kp-webhook-secret": "whs" },
      "{}",
    );
    expect(r.error).not.toBe(REFUSED);
    expect(r.status).not.toBe(403);
  });

  it("未登录的跨站写请求仍先得到 401（校验在会话鉴权之后）", async () => {
    const res = await fetch(`${base}/api/inbox/seen`, {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });
});