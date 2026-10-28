import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import "../../src/server/routes/worker.js";
import { listModularRoutes, type ModularRoute, type RouteContext } from "../../src/server/routes/registry.js";
import { setWorkerEndpoint } from "../../src/server/worker/worker-runtime.js";
import { requestAuthContext } from "../../src/server/auth-context.js";
import { createWorkerConnectionRegistry } from "../../src/server/worker/worker-connections.js";
import { createExecQueue } from "../../src/server/worker/exec-queue.js";
import { createFsQueue } from "../../src/server/worker/fs-queue.js";

const MACHINE = "0123456789abcdef0123456789abcdef";
let stateDir = "";

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

function fakeReq(body: unknown): EventEmitter {
  const req = new EventEmitter() as EventEmitter & { method: string; headers: Record<string, string> };
  req.method = "POST";
  req.headers = { "content-type": "application/json" };
  const payload = JSON.stringify(body ?? {});
  setTimeout(() => { req.emit("data", Buffer.from(payload, "utf8")); req.emit("end"); }, 0);
  return req;
}

async function call(body: unknown, opts: { accountId?: string } = {}): Promise<{ status: number; body: string }> {
  const route = routeOf("POST", "/api/worker/fs");
  const res = new FakeRes();
  const req = fakeReq(body);
  const context: RouteContext = { stateDir };
  const run = async (): Promise<void> => {
    await route.handle(req as never, res as never, "/api/worker/fs", context);
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
  return { status: res.statusCode, body: res.chunks.join("") };
}

const dispatched: Array<{ connId: string; opId: string }> = [];

function endpointWith(opts: { accountId: string; autoRespond?: boolean; dispatchOk?: boolean }): void {
  const registry = createWorkerConnectionRegistry();
  const fsQueue = createFsQueue();
  registry.register({
    connId: "conn-1", accountId: opts.accountId, machineId: MACHINE,
    machineName: "测试机", root: "/tmp", connectedAt: 1,
  });
  setWorkerEndpoint({
    registry,
    execQueue: createExecQueue(),
    fsQueue,
    dispatchExec: () => true,
    dispatchFs: (connId: string, pending: { opId: string }): boolean => {
      dispatched.push({ connId, opId: pending.opId });
      if (opts.dispatchOk === false) return false;
      if (opts.autoRespond === false) return true;
      setTimeout(() => { fsQueue.settle(pending.opId, { ok: true, data: "文件内容" }); }, 10);
      return true;
    },
    close: () => {},
  } as never);
}

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "kp-worker-fs-"));
  dispatched.length = 0;
  setWorkerEndpoint(null);
});
afterEach(() => { setWorkerEndpoint(null); });

describe("路由注册", () => {
  test("四条路由都在,新增不挤掉既有三条", () => {
    for (const [m, p] of [["POST", "/api/worker/fs"], ["POST", "/api/worker/exec"], ["GET", "/api/worker/machines"], ["POST", "/api/worker/token"]]) {
      expect(() => routeOf(m, p), `${m} ${p}`).not.toThrow();
    }
  });
});

describe("鉴权与参数校验", () => {
  test("未登录 → 403", async () => {
    endpointWith({ accountId: "acct-1" });
    expect((await call({ machineId: MACHINE, kind: "read", path: "a.txt" })).status).toBe(403);
  });

  test("通道未启用 → 503", async () => {
    setWorkerEndpoint(null);
    expect((await call({ machineId: MACHINE, kind: "read", path: "a.txt" }, { accountId: "acct-1" })).status).toBe(503);
  });

  test("非法 machineId → 400", async () => {
    endpointWith({ accountId: "acct-1" });
    for (const bad of ["", "短", "0123456789ABCDEF0123456789abcdef"]) {
      expect((await call({ machineId: bad, kind: "read", path: "a.txt" }, { accountId: "acct-1" })).status, String(bad)).toBe(400);
    }
  });

  test("非法 kind → 400", async () => {
    endpointWith({ accountId: "acct-1" });
    for (const bad of ["exec", "chmod", "", 42, undefined]) {
      expect((await call({ machineId: MACHINE, kind: bad, path: "a.txt" }, { accountId: "acct-1" })).status, String(bad)).toBe(400);
    }
  });

  test("write 缺 content → 400", async () => {
    endpointWith({ accountId: "acct-1" });
    expect((await call({ machineId: MACHINE, kind: "write", path: "a.txt" }, { accountId: "acct-1" })).status).toBe(400);
    expect((await call({ machineId: MACHINE, kind: "write", path: "a.txt", content: 42 }, { accountId: "acct-1" })).status).toBe(400);
  });

  test("recursive 非布尔 → 400", async () => {
    endpointWith({ accountId: "acct-1" });
    expect((await call({ machineId: MACHINE, kind: "list", path: ".", recursive: "yes" }, { accountId: "acct-1" })).status).toBe(400);
  });

  test("非法 timeoutMs → 400", async () => {
    endpointWith({ accountId: "acct-1" });
    for (const bad of [0, -1, 1.5, "1000", 120001]) {
      expect((await call({ machineId: MACHINE, kind: "read", path: "a.txt", timeoutMs: bad }, { accountId: "acct-1" })).status, String(bad)).toBe(400);
    }
  });
});

describe("服务端也要挡路径越权(第一道防线)", () => {
  test("越权路径 400 且绝不派发", async () => {
    endpointWith({ accountId: "acct-1" });
    for (const path of ["../etc/passwd", "/etc/passwd", "a/../../b", "C:\\Windows"]) {
      const r = await call({ machineId: MACHINE, kind: "read", path }, { accountId: "acct-1" });
      expect(r.status, path).toBe(400);
    }
    expect(dispatched.length).toBe(0);
  });

  test("path 非字符串 → 400", async () => {
    endpointWith({ accountId: "acct-1" });
    for (const bad of [42, null, undefined, {}]) {
      expect((await call({ machineId: MACHINE, kind: "read", path: bad }, { accountId: "acct-1" })).status, String(bad)).toBe(400);
    }
  });
});

describe("跨账号隔离", () => {
  test("甲的会话拿乙的 machineId → 404,绝不派发", async () => {
    endpointWith({ accountId: "acct-b" });
    const r = await call({ machineId: MACHINE, kind: "delete", path: "重要文件" }, { accountId: "acct-a" });
    expect(r.status).toBe(404);
    expect(dispatched.length).toBe(0);
  });
});

describe("派发与结果", () => {
  test("正常路径返回 ok/data/opId", async () => {
    endpointWith({ accountId: "acct-1" });
    const r = await call({ machineId: MACHINE, kind: "read", path: "a.txt" }, { accountId: "acct-1" });
    expect(r.status).toBe(200);
    const parsed = JSON.parse(r.body) as Record<string, unknown>;
    expect(parsed.ok).toBe(true);
    expect(parsed.data).toBe("文件内容");
    expect(parsed.timedOut).toBe(false);
    expect(typeof parsed.opId).toBe("string");
    expect(dispatched.length).toBe(1);
    expect(dispatched[0].connId).toBe("conn-1");
  });

  test("机器不在线 → 404", async () => {
    setWorkerEndpoint({
      registry: createWorkerConnectionRegistry(),
      execQueue: createExecQueue(),
      fsQueue: createFsQueue(),
      dispatchExec: () => true,
      dispatchFs: () => true,
      close: () => {},
    } as never);
    expect((await call({ machineId: MACHINE, kind: "read", path: "a.txt" }, { accountId: "acct-1" })).status).toBe(404);
  });

  test("派发失败 → 409", async () => {
    endpointWith({ accountId: "acct-1", dispatchOk: false });
    expect((await call({ machineId: MACHINE, kind: "read", path: "a.txt" }, { accountId: "acct-1" })).status).toBe(409);
  });

  test("超时 → 200 且 timedOut 为真", async () => {
    endpointWith({ accountId: "acct-1", autoRespond: false });
    const r = await call({ machineId: MACHINE, kind: "read", path: "a.txt", timeoutMs: 80 }, { accountId: "acct-1" });
    expect(r.status).toBe(200);
    const parsed = JSON.parse(r.body) as Record<string, unknown>;
    expect(parsed.timedOut).toBe(true);
    expect(parsed.ok).toBe(false);
  }, 15_000);

  test("write 的 content 不回显在响应里", async () => {
    endpointWith({ accountId: "acct-1" });
    const r = await call(
      { machineId: MACHINE, kind: "write", path: "a.txt", content: "SECRET_xyz789" },
      { accountId: "acct-1" },
    );
    expect(r.body).not.toContain("SECRET_xyz789");
  });

  test("响应是 json", async () => {
    endpointWith({ accountId: "acct-1" });
    const route = routeOf("POST", "/api/worker/fs");
    const res = new FakeRes();
    await new Promise<void>((resolve, reject) => {
      requestAuthContext.run(
        { accountId: "acct-1", username: "u", profileId: "p1", role: "owner" } as never,
        () => {
          const handled = route.handle(
            fakeReq({ machineId: MACHINE, kind: "read", path: "a.txt" }) as never,
            res as never, "/api/worker/fs", { stateDir },
          );
          void Promise.resolve(handled).then(() => { resolve(); }, reject);
        },
      );
    });
    expect(res.headers["content-type"]).toContain("application/json");
  });
});