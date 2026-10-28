import { describe, expect, test, beforeEach, afterEach } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import "../../src/server/routes/worker.js";
import { listModularRoutes, type ModularRoute, type RouteContext } from "../../src/server/routes/registry.js";
import { setWorkerEndpoint } from "../../src/server/worker/worker-runtime.js";
import { requestAuthContext } from "../../src/server/auth-context.js";
import { attachWorkerWebSocket, WORKER_WS_PATH } from "../../src/server/worker/worker-endpoint.js";
import { createWorkerClient } from "../../src/server/worker/worker-client.js";
import { signWorkerToken, newMachineId, WORKER_PROTOCOL_VERSION } from "../../src/server/worker/worker-token.js";
import {
  addRevocation,
  removeRevocation,
  serializeRevocations,
  saveRevocations,
  parseRevocations,
  revocationFilePath,
  type Revocation,
} from "../../src/server/worker/worker-revocation.js";

const SECRET = "revoke-api-secret";
const MACHINE = "0123456789abcdef0123456789abcdef";
let stateDir = "";
let sandbox = "";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) {
    try { await fn(); } catch { /* 清理尽力而为 */ }
  }
  setWorkerEndpoint(null);
  await rm(sandbox, { recursive: true, force: true });
});

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "kp-revapi-state-"));
  sandbox = await mkdtemp(join(tmpdir(), "kp-revapi-box-"));
  setWorkerEndpoint(null);
});

function routeOf(method: string, path: string): ModularRoute {
  const found = listModularRoutes().find((r) => r.method === method && r.path === path);
  if (!found) throw new Error(`路由未注册: ${method} ${path}`);
  return found;
}

class FakeRes extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};
  chunks: string[] = [];
  setHeader(k: string, v: string): void { this.headers[k.toLowerCase()] = v; }
  end(chunk?: string): void { if (chunk) this.chunks.push(chunk); }
  write(chunk: string): void { this.chunks.push(chunk); }
}

function fakeReq(body?: unknown): EventEmitter {
  const req = new EventEmitter() as EventEmitter & { method: string; headers: Record<string, string> };
  req.method = body === undefined ? "GET" : "POST";
  req.headers = { "content-type": "application/json" };
  const payload = body === undefined ? "" : JSON.stringify(body);
  setTimeout(() => { if (payload) req.emit("data", Buffer.from(payload, "utf8")); req.emit("end"); }, 0);
  return req;
}

async function call(
  method: string, path: string,
  opts: { accountId?: string; body?: unknown } = {},
): Promise<{ status: number; body: string }> {
  const route = routeOf(method, path);
  const res = new FakeRes();
  const req = fakeReq(opts.body);
  const context: RouteContext = { stateDir };
  const run = async (): Promise<void> => { await route.handle(req as never, res as never, path, context); };
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
  return { status: res.statusCode, body: res.chunks.join("") };
}

describe("纯函数:增删与序列化", () => {
  test("addRevocation 同键替换而不是重复", () => {
    const a: Revocation[] = [{ accountId: "a", machineId: "m", reason: "旧" }];
    const b = addRevocation(a, { accountId: "a", machineId: "m", reason: "新" });
    expect(b.length).toBe(1);
    expect(b[0].reason).toBe("新");
  });

  test("addRevocation 不同键追加且稳定排序", () => {
    let list: Revocation[] = [];
    list = addRevocation(list, { accountId: "b", machineId: "m2" });
    list = addRevocation(list, { accountId: "a", machineId: "m1" });
    const again = addRevocation(addRevocation([], { accountId: "a", machineId: "m1" }), { accountId: "b", machineId: "m2" });
    expect(list).toEqual(again);
  });

  test("removeRevocation 两者都匹配才移", () => {
    const list: Revocation[] = [{ accountId: "a", machineId: "m" }];
    expect(removeRevocation(list, "a", "m").length).toBe(0);
    expect(removeRevocation(list, "b", "m").length).toBe(1);
    expect(removeRevocation(list, "a", "x").length).toBe(1);
  });

  test("序列化后能被 parseRevocations 原样读回", () => {
    const list: Revocation[] = [{ accountId: "a", machineId: "m", at: 1, reason: "丢了" }];
    const state = parseRevocations(serializeRevocations(list));
    expect(state.ok).toBe(true);
    if (state.ok) expect(state.list).toEqual(list);
  });

  test("纯函数:不改原数组", () => {
    const list: Revocation[] = [{ accountId: "a", machineId: "m" }];
    addRevocation(list, { accountId: "b", machineId: "n" });
    removeRevocation(list, "a", "m");
    expect(list.length).toBe(1);
  });

  test("saveRevocations 落盘,目录不存在也能建", async () => {
    const env = { KUNPENG_STATE: join(sandbox, "深", "一点") } as NodeJS.ProcessEnv;
    await saveRevocations([{ accountId: "a", machineId: "m" }], env);
    const path = revocationFilePath(env);
    expect(existsSync(path)).toBe(true);
    const state = parseRevocations(await readFile(path, "utf8"));
    expect(state.ok).toBe(true);
  });
});

describe("路由:鉴权与校验", () => {
  test("三条路由都注册了", () => {
    expect(() => routeOf("GET", "/api/worker/revoked")).not.toThrow();
    expect(() => routeOf("POST", "/api/worker/revoke")).not.toThrow();
    expect(() => routeOf("POST", "/api/worker/unrevoke")).not.toThrow();
  });

  test("既有四条路由没被挤掉", () => {
    for (const [m, p] of [["GET", "/api/worker/machines"], ["POST", "/api/worker/token"],
      ["POST", "/api/worker/exec"], ["POST", "/api/worker/fs"]]) {
      expect(() => routeOf(m, p), `${m} ${p}`).not.toThrow();
    }
  });

  test("未登录一律 403", async () => {
    expect((await call("GET", "/api/worker/revoked")).status).toBe(403);
    expect((await call("POST", "/api/worker/revoke", { body: { machineId: MACHINE } })).status).toBe(403);
    expect((await call("POST", "/api/worker/unrevoke", { body: { machineId: MACHINE } })).status).toBe(403);
  });

  test("非法 machineId 一律 400", async () => {
    for (const bad of ["", "短", "0123456789ABCDEF0123456789abcdef", "../x"]) {
      expect((await call("POST", "/api/worker/revoke", { accountId: "acct-1", body: { machineId: bad } })).status,
        String(bad)).toBe(400);
      expect((await call("POST", "/api/worker/unrevoke", { accountId: "acct-1", body: { machineId: bad } })).status,
        String(bad)).toBe(400);
    }
  });
});

describe("路由:读写与隔离", () => {
  test("revoke 之后 revoked 里能查到", async () => {
    const env = { KUNPENG_STATE: sandbox } as NodeJS.ProcessEnv;
    void env;
    const r = await call("POST", "/api/worker/revoke", {
      accountId: "acct-1", body: { machineId: MACHINE, reason: "笔记本丢了" },
    });
    expect(r.status).toBe(200);
    const listed = await call("GET", "/api/worker/revoked", { accountId: "acct-1" });
    expect(listed.status).toBe(200);
    expect(listed.body).toContain(MACHINE);
    expect(listed.body).toContain("笔记本丢了");
  });

  test("只返回本账号的条目", async () => {
    await call("POST", "/api/worker/revoke", { accountId: "acct-jia", body: { machineId: MACHINE } });
    const listed = await call("GET", "/api/worker/revoked", { accountId: "acct-yi" });
    expect(listed.status).toBe(200);
    expect(listed.body).not.toContain(MACHINE);
  });

  test("unrevoke 之后查不到", async () => {
    await call("POST", "/api/worker/revoke", { accountId: "acct-1", body: { machineId: MACHINE } });
    expect((await call("POST", "/api/worker/unrevoke", { accountId: "acct-1", body: { machineId: MACHINE } })).status).toBe(200);
    expect((await call("GET", "/api/worker/revoked", { accountId: "acct-1" })).body).not.toContain(MACHINE);
  });

  test("名单损坏 → 三条都 503,且不覆盖那个文件", async () => {
    const path = revocationFilePath();
    const backup = existsSync(path) ? await readFile(path, "utf8") : null;
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "{ 这不是 json", "utf8");
    cleanups.push(async () => {
      if (backup === null) await rm(path, { force: true });
      else await writeFile(path, backup, "utf8");
    });
    expect((await call("GET", "/api/worker/revoked", { accountId: "acct-1" })).status).toBe(503);
    expect((await call("POST", "/api/worker/revoke", { accountId: "acct-1", body: { machineId: MACHINE } })).status).toBe(503);
    expect((await call("POST", "/api/worker/unrevoke", { accountId: "acct-1", body: { machineId: MACHINE } })).status).toBe(503);
    expect(await readFile(path, "utf8"), "损坏的文件不该被覆盖").toBe("{ 这不是 json");
  });
});

describe("端到端:吊销后立刻断开,再连被拒", () => {
  async function bootWorker(accountId: string, machineId: string): Promise<{
    endpoint: ReturnType<typeof attachWorkerWebSocket>;
    url: string;
  }> {
    const root = await mkdtemp(join(tmpdir(), "kp-revapi-root-"));
    const server: Server = http.createServer((_req, res) => res.end("ok"));
    const revoked: Revocation[] = [];
    const endpoint = attachWorkerWebSocket(server, {
      resolveSecret: async () => SECRET,
      resolveRevocations: async () => {
        const state = parseRevocations(await readFile(revocationFilePath(), "utf8").catch(() => null));
        return state;
      },
    } as never);
    void revoked;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (typeof addr === "string" || addr === null) throw new Error("拿不到端口");
    const url = `ws://127.0.0.1:${addr.port}${WORKER_WS_PATH}`;
    const client = createWorkerClient({
      url, token: signWorkerToken(accountId, machineId, SECRET, Date.now()),
      machineName: "待吊销机", root,
    });
    cleanups.push(() => client.stop());
    cleanups.push(() => { endpoint.close(); server.close(); });
    client.start();
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && endpoint.registry.listByAccount(accountId).length === 0) {
      await new Promise((r) => setTimeout(r, 25));
    }
    setWorkerEndpoint(endpoint as never);
    return { endpoint, url };
  }

  function rawConnect(url: string, accountId: string, machineId: string): Promise<string> {
    return new Promise((resolve) => {
      const ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${signWorkerToken(accountId, machineId, SECRET, Date.now())}`,
          "X-Kunpeng-Worker-Protocol": String(WORKER_PROTOCOL_VERSION),
        },
      });
      cleanups.push(() => ws.close());
      let settled = false;
      const done = (v: string): void => { if (!settled) { settled = true; resolve(v); } };
      ws.on("open", () => { ws.close(); done("connected"); });
      ws.on("unexpected-response", (_r, res) => { res.resume(); done(String(res.statusCode)); });
      ws.on("error", () => done("error"));
      setTimeout(() => done("timeout"), 6000);
    });
  }

  test("在线机器被 revoke 后立刻从 registry 消失,且再连 403", async () => {
    const machineId = newMachineId();
    const { endpoint, url } = await bootWorker("acct-e2e", machineId);
    const path = revocationFilePath();
    const backup = existsSync(path) ? await readFile(path, "utf8") : null;
    cleanups.push(async () => {
      if (backup === null) await rm(path, { force: true });
      else await writeFile(path, backup, "utf8");
    });

    expect(endpoint.registry.listByAccount("acct-e2e").length).toBe(1);
    const r = await call("POST", "/api/worker/revoke", {
      accountId: "acct-e2e", body: { machineId, reason: "端到端测试" },
    });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).disconnected).toBe(true);

    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && endpoint.registry.listByAccount("acct-e2e").length > 0) {
      await new Promise((res) => setTimeout(res, 25));
    }
    expect(endpoint.registry.listByAccount("acct-e2e").length, "吊销后应当被断开").toBe(0);
    expect(await rawConnect(url, "acct-e2e", machineId)).toBe("403");

    expect((await call("POST", "/api/worker/unrevoke", { accountId: "acct-e2e", body: { machineId } })).status).toBe(200);
    expect(await rawConnect(url, "acct-e2e", machineId)).toBe("connected");
  }, 40_000);

  test("在飞的 exec 在吊销断开时立刻收尾", async () => {
    const machineId = newMachineId();
    const { endpoint } = await bootWorker("acct-inflight", machineId);
    const path = revocationFilePath();
    const backup = existsSync(path) ? await readFile(path, "utf8") : null;
    cleanups.push(async () => {
      if (backup === null) await rm(path, { force: true });
      else await writeFile(path, backup, "utf8");
    });
    const conn = endpoint.registry.listByAccount("acct-inflight")[0];
    const { result } = endpoint.execQueue.submit("c", "sleep 30", { timeoutMs: 600_000 });
    endpoint.dispatchExec(conn.connId, endpoint.execQueue.take("c") as never, 600_000);
    await new Promise((r) => setTimeout(r, 200));

    await call("POST", "/api/worker/revoke", { accountId: "acct-inflight", body: { machineId } });
    const settled = await Promise.race([
      result.then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 4000)),
    ]);
    expect(settled, "吊销断开后在飞操作应当立刻收尾").toBe(true);
  }, 40_000);

  test("disconnectMachine 跨账号取不到", async () => {
    const machineId = newMachineId();
    const { endpoint } = await bootWorker("acct-own", machineId);
    expect(endpoint.disconnectMachine("acct-other", machineId, "试图断别人的")).toBe(false);
    expect(endpoint.registry.listByAccount("acct-own").length, "别人的机器不该被断").toBe(1);
  }, 40_000);

  test("disconnectMachine 对不在线的机器返回 false", async () => {
    const { endpoint } = await bootWorker("acct-off", newMachineId());
    expect(endpoint.disconnectMachine("acct-off", "ffffffffffffffffffffffffffffffff", "x")).toBe(false);
  }, 40_000);
});