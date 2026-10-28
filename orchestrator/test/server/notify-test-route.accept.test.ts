import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/server/routes/settings.js";
import { dispatchModularRoute } from "../../src/server/routes/registry.js";
import { capabilityForRoute } from "../../src/server/authz.js";

let home: string;
const fetchCalls: string[] = [];

function fakeReq(method: string, body: string): IncomingMessage {
  const r = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage;
  (r as unknown as { method: string }).method = method;
  (r as unknown as { headers: Record<string, string> }).headers = { "content-type": "application/json" };
  return r;
}

function fakeRes(): { res: ServerResponse; body: () => string } {
  let out = "";
  const res = {
    statusCode: 200,
    setHeader: () => undefined,
    writeHead: () => undefined,
    end: (chunk?: string) => { out += chunk ?? ""; },
  } as unknown as ServerResponse;
  return { res, body: () => out };
}

async function callTest(): Promise<{ ok: boolean; sent?: string[]; failed?: string[]; error?: string }> {
  const { res, body } = fakeRes();
  const hit = await dispatchModularRoute("POST", "/api/settings/notify/test", fakeReq("POST", "{}"), res, { stateDir: home });
  expect(hit).toBe(true);
  return JSON.parse(body()) as { ok: boolean; sent?: string[]; failed?: string[]; error?: string };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kp-notify-test-route-"));
  mkdirSync(join(home, ".kunpeng"), { recursive: true });
  vi.stubEnv("HOME", home);
  fetchCalls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    fetchCalls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ success: true, code: 1000 }) };
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(home, { recursive: true, force: true });
});

describe("POST /api/settings/notify/test（作者锁定）", () => {
  it("只有 owner（admin 能力）能调", () => {
    expect(capabilityForRoute("/api/settings/notify/test", "POST")).toBe("admin");
  });

  it("用已保存的 notify.json 真发一条测试消息，返回各通道 sent", async () => {
    writeFileSync(join(home, ".kunpeng", "notify.json"), JSON.stringify({ wxpusher: { appToken: "AT_demo", uid: "UID_demo" } }));
    const r = await callTest();
    expect(r.ok).toBe(true);
    expect(r.sent).toEqual(["wxpusher"]);
    expect(r.failed).toEqual([]);
    expect(fetchCalls.some((u) => u.includes("wxpusher"))).toBe(true);
  });

  it("一个通道都没配 → ok:false 且有中文错误，不发任何请求", async () => {
    const r = await callTest();
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain("未配置");
    expect(fetchCalls.length).toBe(0);
  });

  it("通道返回失败 → ok:false，failed 里点名该通道", async () => {
    writeFileSync(join(home, ".kunpeng", "notify.json"), JSON.stringify({ wxpusher: { appToken: "bad", uid: "UID_demo" } }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: false, code: 1001 }) })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = await callTest();
    warn.mockRestore();
    expect(r.ok).toBe(false);
    expect(r.failed).toEqual(["wxpusher"]);
  });
});