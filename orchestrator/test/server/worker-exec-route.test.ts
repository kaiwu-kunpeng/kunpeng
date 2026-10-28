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

async function call(
  body: unknown,
  opts: { accountId?: string } = {},
): Promise<{ status: number; body: string }> {
  const route = routeOf("POST", "/api/worker/exec");
  const res = new FakeRes();
  const req = fakeReq(body);
  const context: RouteContext = { stateDir };
  const run = async (): Promise<void> => {
    await route.handle(req as never, res as never, "/api/worker/exec", context);
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

/** 造一个已连上一台机器的端点;autoRespond 决定被派发时是否自动回结果。 */
function endpointWith(opts: {
  accountId: string;
  machineId: string;
  autoRespond?: "ok" | "none";
  dispatchOk?: boolean;
}): { registry: ReturnType<typeof createWorkerConnectionRegistry>; execQueue: ReturnType<typeof createExecQueue> } {
  const registry = createWorkerConnectionRegistry();
  const execQueue = createExecQueue();
  registry.register({
    connId: "conn-1",
    accountId: opts.accountId,
    machineId: opts.machineId,
    machineName: "测试机",
    root: "/tmp",
    connectedAt: 1,
  });
  const endpoint = {
    registry,
    execQueue,
    dispatchExec: (_connId: string, pending: { execId: string }): boolean => {
      if (opts.dispatchOk === false) return false;
      if (opts.autoRespond === "none") return true;
      setTimeout(() => {
        execQueue.pushChunk(pending.execId, "stdout", "已执行\n");
        execQueue.complete(pending.execId, { exitCode: 0 });
      }, 10);
      return true;
    },
    close: () => {},
  };
  setWorkerEndpoint(endpoint as never);
  return { registry, execQueue };
}

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "kp-worker-exec-"));
  setWorkerEndpoint(null);
});
afterEach(() => { setWorkerEndpoint(null); });

describe("路由注册", () => {
  test("三条路由都在,新增不挤掉既有两条", () => {
    expect(() => routeOf("POST", "/api/worker/exec")).not.toThrow();
    expect(() => routeOf("GET", "/api/worker/machines")).not.toThrow();
    expect(() => routeOf("POST", "/api/worker/token")).not.toThrow();
  });
});

describe("鉴权与前置校验", () => {
  test("未登录 → 403", async () => {
    endpointWith({ accountId: "acct-1", machineId: MACHINE });
    expect((await call({ machineId: MACHINE, command: "echo hi" })).status).toBe(403);
  });

  test("通道未启用 → 503", async () => {
    setWorkerEndpoint(null);
    const r = await call({ machineId: MACHINE, command: "echo hi" }, { accountId: "acct-1" });
    expect(r.status).toBe(503);
  });

  test("非法 machineId → 400", async () => {
    endpointWith({ accountId: "acct-1", machineId: MACHINE });
    for (const bad of ["", "短", "0123456789ABCDEF0123456789abcdef", "../etc", "0123456789abcdef.123456789abcde"]) {
      const r = await call({ machineId: bad, command: "echo hi" }, { accountId: "acct-1" });
      expect(r.status, `machineId=${JSON.stringify(bad)}`).toBe(400);
    }
  });

  test("空 command → 400", async () => {
    endpointWith({ accountId: "acct-1", machineId: MACHINE });
    for (const bad of ["", "   ", undefined, 42, null]) {
      const r = await call({ machineId: MACHINE, command: bad }, { accountId: "acct-1" });
      expect(r.status, `command=${JSON.stringify(bad)}`).toBe(400);
    }
  });

  test("非法 timeoutMs → 400", async () => {
    endpointWith({ accountId: "acct-1", machineId: MACHINE });
    for (const bad of [0, -1, 1.5, "5000", 600001]) {
      const r = await call({ machineId: MACHINE, command: "echo hi", timeoutMs: bad }, { accountId: "acct-1" });
      expect(r.status, `timeoutMs=${JSON.stringify(bad)}`).toBe(400);
    }
  });
});

describe("跨账号隔离(本流最重要的一条)", () => {
  test("甲的会话拿乙的 machineId → 404,绝不执行", async () => {
    endpointWith({ accountId: "acct-乙", machineId: MACHINE });
    const r = await call({ machineId: MACHINE, command: "rm -rf /" }, { accountId: "acct-甲" });
    expect(r.status).toBe(404);
    expect(r.body).not.toContain("已执行");
  });

  test("本账号的机器可以执行", async () => {
    endpointWith({ accountId: "acct-甲", machineId: MACHINE });
    const r = await call({ machineId: MACHINE, command: "echo hi" }, { accountId: "acct-甲" });
    expect(r.status).toBe(200);
  });
});

describe("派发与结果", () => {
  test("正常路径返回完整结果字段", async () => {
    endpointWith({ accountId: "acct-1", machineId: MACHINE });
    const r = await call({ machineId: MACHINE, command: "echo hi" }, { accountId: "acct-1" });
    expect(r.status).toBe(200);
    const parsed = JSON.parse(r.body) as Record<string, unknown>;
    expect(parsed.stdout).toBe("已执行\n");
    expect(parsed.exitCode).toBe(0);
    expect(parsed.timedOut).toBe(false);
    expect(parsed.truncated).toBe(false);
    expect(typeof parsed.execId).toBe("string");
  });

  test("机器不在线 → 404", async () => {
    const registry = createWorkerConnectionRegistry();
    setWorkerEndpoint({
      registry,
      execQueue: createExecQueue(),
      dispatchExec: () => true,
      close: () => {},
    } as never);
    const r = await call({ machineId: MACHINE, command: "echo hi" }, { accountId: "acct-1" });
    expect(r.status).toBe(404);
  });

  test("派发失败 → 409", async () => {
    endpointWith({ accountId: "acct-1", machineId: MACHINE, dispatchOk: false });
    const r = await call({ machineId: MACHINE, command: "echo hi" }, { accountId: "acct-1" });
    expect(r.status).toBe(409);
  });

  test("超时 → 200 且 timedOut 为真(不是 500)", async () => {
    endpointWith({ accountId: "acct-1", machineId: MACHINE, autoRespond: "none" });
    const r = await call({ machineId: MACHINE, command: "sleep 999", timeoutMs: 60 }, { accountId: "acct-1" });
    expect(r.status).toBe(200);
    const parsed = JSON.parse(r.body) as Record<string, unknown>;
    expect(parsed.timedOut).toBe(true);
    expect(parsed.exitCode).toBeNull();
  }, 15_000);

  test("响应是 json", async () => {
    endpointWith({ accountId: "acct-1", machineId: MACHINE });
    const route = routeOf("POST", "/api/worker/exec");
    const res = new FakeRes();
    await new Promise<void>((resolve, reject) => {
      requestAuthContext.run(
        { accountId: "acct-1", username: "u", profileId: "p1", role: "owner" } as never,
        () => {
          const handled = route.handle(
            fakeReq({ machineId: MACHINE, command: "x" }) as never,
            res as never,
            "/api/worker/exec",
            { stateDir },
          );
          void Promise.resolve(handled).then(() => { resolve(); }, reject);
        },
      );
    });
    expect(res.headers["content-type"]).toContain("application/json");
  });

  test("命令全文不出现在响应里(只回执行结果,不回显命令)", async () => {
    endpointWith({ accountId: "acct-1", machineId: MACHINE });
    const r = await call(
      { machineId: MACHINE, command: "echo SECRET_abc123" },
      { accountId: "acct-1" },
    );
    expect(r.body).not.toContain("SECRET_abc123");
  });
});