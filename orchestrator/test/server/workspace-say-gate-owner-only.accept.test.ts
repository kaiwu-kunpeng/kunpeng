import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const streamSay = vi.fn(async (_driver: unknown, _ws: string, _msg: string, res: ServerResponse) => { res.end("ok"); });
const handleGate = vi.fn(async () => ({ ok: true }));

vi.mock("../../src/server/workspace-endpoints.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  streamSay,
}));
vi.mock("../../src/server/gate-endpoints.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  handleGate,
}));

const { requestAuthContext } = await import("../../src/server/auth-context.js");
const { handleWorkspaceRoute } = await import("../../src/server/workspace-route.js");

class FakeResponse extends EventEmitter {
  statusCode = 200;
  body = "";
  setHeader(): this { return this; }
  writeHead(status: number): this { this.statusCode = status; return this; }
  write(chunk: unknown): boolean { this.body += String(chunk); return true; }
  end(chunk?: unknown): this { if (chunk !== undefined) this.body += String(chunk); return this; }
}

function req(body: unknown): IncomingMessage {
  const r = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
  Object.assign(r, { headers: { host: "cockpit.test", "sec-fetch-site": "same-origin" } });
  return r;
}

const CASES = [
  { kind: "say", method: "POST", url: "/api/workspace/project-a/say" },
  { kind: "events", method: "GET", url: "/api/workspace/project-a/events?msg=%E6%94%B9%E4%BB%A3%E7%A0%81" },
  { kind: "gate", method: "POST", url: "/api/workspace/project-a/gate" },
] as const;

async function call(role: "owner" | "member" | undefined, c: (typeof CASES)[number]): Promise<FakeResponse> {
  const raw = new FakeResponse();
  const run = () => handleWorkspaceRoute(c.method, c.url, req({ message: "改代码", decision: "yes" }), raw as unknown as ServerResponse, {});
  if (role === undefined) await run();
  else await requestAuthContext.run({ username: role, profileId: "home", role }, run);
  return raw;
}

beforeEach(() => { streamSay.mockClear(); handleGate.mockClear(); });

describe("工作区 say/events/gate 只放 owner（作者锁定）", () => {
  it.each(CASES)("member 调 $kind → 403，不起 DevCycle、不过门", async (c) => {
    const raw = await call("member", c);
    expect(raw.statusCode).toBe(403);
    expect(raw.body).toContain(`${c.kind} requires owner role`);
    expect(streamSay).not.toHaveBeenCalled();
    expect(handleGate).not.toHaveBeenCalled();
  });

  it.each(CASES)("owner 调 $kind → 照常放行", async (c) => {
    const raw = await call("owner", c);
    expect(raw.statusCode).toBe(200);
    expect(streamSay.mock.calls.length + handleGate.mock.calls.length).toBe(1);
  });

  it.each(CASES)("无鉴权上下文（本机）调 $kind → 照常放行", async (c) => {
    const raw = await call(undefined, c);
    expect(raw.statusCode).toBe(200);
    expect(streamSay.mock.calls.length + handleGate.mock.calls.length).toBe(1);
  });
});