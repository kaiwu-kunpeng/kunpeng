import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import "../../src/server/routes/worker.js";
import { listModularRoutes, type ModularRoute, type RouteContext } from "../../src/server/routes/registry.js";
import { setWorkerEndpoint, getWorkerEndpoint } from "../../src/server/worker/worker-runtime.js";
import { requestAuthContext } from "../../src/server/auth-context.js";
import { createWorkerConnectionRegistry } from "../../src/server/worker/worker-connections.js";
import { createExecQueue } from "../../src/server/worker/exec-queue.js";
import { verifyWorkerToken } from "../../src/server/worker/worker-token.js";

const SECRET = "route-test-secret";
let stateDir = "";

function routeOf(method: string, path: string): ModularRoute {
  const found = listModularRoutes().find((r) => r.method === method && r.path === path);
  if (!found) throw new Error(`路由未注册: ${method} ${path}`);
  return found;
}

interface Captured {
  status: number;
  headers: Record<string, string>;
  body: string;
}

class FakeRes extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};
  chunks: string[] = [];
  setHeader(k: string, v: string): void { this.headers[k.toLowerCase()] = v; }
  end(chunk?: string): void { if (chunk) this.chunks.push(chunk); }
  write(chunk: string): void { this.chunks.push(chunk); }
}

function fakeReq(body?: unknown): EventEmitter & { method: string; headers: Record<string, string> } {
  const req = new EventEmitter() as EventEmitter & { method: string; headers: Record<string, string> };
  req.method = body === undefined ? "GET" : "POST";
  req.headers = { "content-type": "application/json" };
  const payload = body === undefined ? "" : JSON.stringify(body);
  setTimeout(() => {
    if (payload) req.emit("data", Buffer.from(payload, "utf8"));
    req.emit("end");
  }, 0);
  return req;
}

async function call(
  route: ModularRoute,
  opts: { accountId?: string; body?: unknown; url?: string } = {},
): Promise<Captured> {
  const res = new FakeRes();
  const req = fakeReq(opts.body);
  const context: RouteContext = { stateDir };
  const run = async (): Promise<void> => {
    await route.handle(req as never, res as never, opts.url ?? route.path, context);
  };
  if (opts.accountId) {
    await new Promise<void>((resolve, reject) => {
      requestAuthContext.run(
        { accountId: opts.accountId, username: opts.accountId, profileId: "p1", role: "owner" } as never,
        () => { run().then(resolve, reject); },
      );
    });
  } else {
    await run();
  }
  return { status: res.statusCode, headers: res.headers, body: res.chunks.join("") };
}

async function writeAuthConfig(enabled: boolean): Promise<void> {
  if (!enabled) return;
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    join(stateDir, "auth.json"),
    JSON.stringify({
      secret: SECRET,
      accounts: [{
        username: "acct-1", salt: "aa", hash: "bb",
        profileId: "p1", role: "owner", updatedAt: 1,
      }],
    }),
    "utf8",
  );
}

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "kp-worker-routes-"));
  setWorkerEndpoint(null);
});

afterEach(() => {
  setWorkerEndpoint(null);
});

describe("worker 路由 · 注册", () => {
  test("两条路由都注册了", () => {
    expect(() => routeOf("GET", "/api/worker/machines")).not.toThrow();
    expect(() => routeOf("POST", "/api/worker/token")).not.toThrow();
  });

  test("worker-runtime 默认 null,可设可清", () => {
    expect(getWorkerEndpoint()).toBeNull();
    const fake = { registry: createWorkerConnectionRegistry(), execQueue: createExecQueue() };
    setWorkerEndpoint(fake as never);
    expect(getWorkerEndpoint()).not.toBeNull();
    setWorkerEndpoint(null);
    expect(getWorkerEndpoint()).toBeNull();
  });
});

describe("GET /api/worker/machines", () => {
  test("未登录 → 403", async () => {
    await writeAuthConfig(true);
    const r = await call(routeOf("GET", "/api/worker/machines"));
    expect(r.status).toBe(403);
  });

  test("端点未启用 → 503,不得用空列表冒充", async () => {
    await writeAuthConfig(true);
    const r = await call(routeOf("GET", "/api/worker/machines"), { accountId: "acct-1" });
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body).machines).toBeUndefined();
  });

  test("正常返回本账号的机器,且是 json", async () => {
    await writeAuthConfig(true);
    const registry = createWorkerConnectionRegistry();
    registry.register({
      connId: "c1", accountId: "acct-1", machineId: "m1",
      machineName: "出差本", root: "/w", connectedAt: 111,
    });
    setWorkerEndpoint({ registry, execQueue: createExecQueue() } as never);
    const r = await call(routeOf("GET", "/api/worker/machines"), { accountId: "acct-1" });
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("application/json");
    const body = JSON.parse(r.body) as { machines: Array<Record<string, unknown>> };
    expect(body.machines.length).toBe(1);
    expect(body.machines[0].machineId).toBe("m1");
    expect(body.machines[0].machineName).toBe("出差本");
    expect(body.machines[0].root).toBe("/w");
  });

  test("别的账号的机器一台都不漏", async () => {
    await writeAuthConfig(true);
    const registry = createWorkerConnectionRegistry();
    registry.register({ connId: "c1", accountId: "acct-1", machineId: "m1", machineName: "我的", root: "/a", connectedAt: 1 });
    registry.register({ connId: "c2", accountId: "acct-other", machineId: "m2", machineName: "别人的", root: "/b", connectedAt: 2 });
    setWorkerEndpoint({ registry, execQueue: createExecQueue() } as never);
    const r = await call(routeOf("GET", "/api/worker/machines"), { accountId: "acct-1" });
    const body = JSON.parse(r.body) as { machines: Array<Record<string, unknown>> };
    expect(body.machines.length).toBe(1);
    expect(JSON.stringify(body)).not.toContain("别人的");
    expect(JSON.stringify(body)).not.toContain("acct-other");
  });
});

describe("POST /api/worker/token", () => {
  test("未登录 → 403", async () => {
    await writeAuthConfig(true);
    const r = await call(routeOf("POST", "/api/worker/token"), { body: {} });
    expect(r.status).toBe(403);
  });

  test("未启用鉴权 → 503(fail-closed,不得裸签)", async () => {
    const r = await call(routeOf("POST", "/api/worker/token"), { accountId: "acct-1", body: {} });
    expect(r.status).toBe(503);
    expect(r.body).not.toContain("w1.");
  });

  test("签出的 token 能被同密钥验过,accountId 等于当前登录账号", async () => {
    await writeAuthConfig(true);
    const r = await call(routeOf("POST", "/api/worker/token"), { accountId: "acct-1", body: {} });
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body) as { token: string; machineId: string };
    expect(typeof body.token).toBe("string");
    expect(body.machineId).toMatch(/^[0-9a-f]{32}$/);
    const parsed = verifyWorkerToken(body.token, SECRET, Date.now(), 365 * 24 * 60 * 60 * 1000);
    expect(parsed).not.toBeNull();
    expect(parsed?.accountId).toBe("acct-1");
    expect(parsed?.machineId).toBe(body.machineId);
  });

  test("给定合法 machineId 时沿用它", async () => {
    await writeAuthConfig(true);
    const machineId = "0123456789abcdef0123456789abcdef";
    const r = await call(routeOf("POST", "/api/worker/token"), { accountId: "acct-1", body: { machineId } });
    expect(r.status).toBe(200);
    expect((JSON.parse(r.body) as { machineId: string }).machineId).toBe(machineId);
  });

  test("非法 machineId 一律 400", async () => {
    await writeAuthConfig(true);
    const bad = [
      "",
      "短",
      "0123456789abcdef0123456789abcde",
      "0123456789abcdef0123456789abcdeff",
      "0123456789ABCDEF0123456789abcdef",
      "0123456789abcdef.0123456789abcde",
      "../0123456789abcdef0123456789ab",
      "0123456789abcdef0123456789abcdeg",
    ];
    for (const machineId of bad) {
      const r = await call(routeOf("POST", "/api/worker/token"), { accountId: "acct-1", body: { machineId } });
      expect(r.status, `machineId=${JSON.stringify(machineId)} 应当被拒`).toBe(400);
    }
  });

  test("token 不出现在响应头里", async () => {
    await writeAuthConfig(true);
    const r = await call(routeOf("POST", "/api/worker/token"), { accountId: "acct-1", body: {} });
    expect(JSON.stringify(r.headers)).not.toContain("w1.");
  });

  test("两次签发的 machineId 不同(默认每次新机器)", async () => {
    await writeAuthConfig(true);
    const a = JSON.parse((await call(routeOf("POST", "/api/worker/token"), { accountId: "acct-1", body: {} })).body) as { machineId: string };
    const b = JSON.parse((await call(routeOf("POST", "/api/worker/token"), { accountId: "acct-1", body: {} })).body) as { machineId: string };
    expect(a.machineId).not.toBe(b.machineId);
  });
});