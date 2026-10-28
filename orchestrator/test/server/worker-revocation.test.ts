import { describe, expect, test, afterEach } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import {
  parseRevocations,
  isRevoked,
  revocationFilePath,
  type Revocation,
} from "../../src/server/worker/worker-revocation.js";
import { attachWorkerWebSocket, WORKER_WS_PATH } from "../../src/server/worker/worker-endpoint.js";
import { signWorkerToken, newMachineId, WORKER_PROTOCOL_VERSION } from "../../src/server/worker/worker-token.js";
import { kunpengStateDir } from "../../src/project/state-dir.js";

const SECRET = "revoke-secret";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) {
    try { await fn(); } catch { /* 清理尽力而为 */ }
  }
});

describe("parseRevocations", () => {
  test("空 / null / 空白 → 没吊销过任何机器,不是错误", () => {
    for (const raw of [null, "", "   ", "\n"]) {
      const state = parseRevocations(raw);
      expect(state.ok, `输入 ${JSON.stringify(raw)}`).toBe(true);
      if (state.ok) expect(state.list).toEqual([]);
    }
  });

  test("合法名单正确解析", () => {
    const state = parseRevocations(JSON.stringify({
      revoked: [{ accountId: "a1", machineId: "m1", at: 123, reason: "笔记本丢了" }],
    }));
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(state.list.length).toBe(1);
      expect(state.list[0].accountId).toBe("a1");
      expect(state.list[0].machineId).toBe("m1");
      expect(state.list[0].reason).toBe("笔记本丢了");
    }
  });

  test("单条脏数据被跳过,不废掉整份名单", () => {
    const state = parseRevocations(JSON.stringify({
      revoked: [
        { accountId: "a1", machineId: "m1" },
        { accountId: "", machineId: "m2" },
        { machineId: "m3" },
        { accountId: "a4" },
        42,
        null,
        { accountId: "a5", machineId: "m5" },
      ],
    }));
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(state.list.map((r) => r.machineId).sort()).toEqual(["m1", "m5"]);
    }
  });

  test("坏 JSON / 顶层非对象 / revoked 非数组 → ok:false", () => {
    for (const raw of ["{ 这不是 json", "[]", "null", '"字符串"', JSON.stringify({ revoked: "不是数组" })]) {
      const state = parseRevocations(raw);
      expect(state.ok, `输入 ${JSON.stringify(raw)}`).toBe(false);
      if (!state.ok) expect(state.error).toContain("吊销名单");
    }
  });

  test("at / reason 类型不对时省略该字段", () => {
    const state = parseRevocations(JSON.stringify({
      revoked: [{ accountId: "a", machineId: "m", at: "昨天", reason: 42 }],
    }));
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(state.list[0].at).toBeUndefined();
      expect(state.list[0].reason).toBeUndefined();
    }
  });
});

describe("isRevoked 必须账号+机器都匹配", () => {
  const list: Revocation[] = [{ accountId: "acct-A", machineId: "机器1" }];

  test("两者都匹配 → 已吊销", () => {
    expect(isRevoked(list, "acct-A", "机器1")).toBe(true);
  });

  test("只匹配 machineId 不算(绝不能波及别的账号)", () => {
    expect(isRevoked(list, "acct-B", "机器1")).toBe(false);
  });

  test("只匹配 accountId 不算", () => {
    expect(isRevoked(list, "acct-A", "机器2")).toBe(false);
  });

  test("空名单一律 false", () => {
    expect(isRevoked([], "acct-A", "机器1")).toBe(false);
  });
});

describe("revocationFilePath", () => {
  test("落在 kunpengStateDir 下,尊重 KUNPENG_STATE", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "kp-revoke-path-"));
    const env = { KUNPENG_STATE: sandbox } as NodeJS.ProcessEnv;
    expect(revocationFilePath(env)).toBe(join(kunpengStateDir(env), "worker-revoked.json"));
    expect(revocationFilePath(env).startsWith(sandbox)).toBe(true);
  });

  test("绝不落主仓根", () => {
    const p = revocationFilePath({} as NodeJS.ProcessEnv);
    expect(p).toContain(".kunpeng");
    expect(p).not.toBe(join(homedir(), "kunpeng", "worker-revoked.json"));
  });
});

describe("握手时的吊销检查", () => {
  async function host(resolveRevocations?: () => Promise<unknown>): Promise<string> {
    const server: Server = http.createServer((_req, res) => res.end("ok"));
    const endpoint = attachWorkerWebSocket(server, {
      resolveSecret: async () => SECRET,
      ...(resolveRevocations ? { resolveRevocations } : {}),
    } as never);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (typeof addr === "string" || addr === null) throw new Error("拿不到端口");
    cleanups.push(() => { endpoint.close(); server.close(); });
    return `ws://127.0.0.1:${addr.port}${WORKER_WS_PATH}`;
  }

  function tryConnect(url: string, accountId: string, machineId: string): Promise<string> {
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
      ws.on("unexpected-response", (_req, res) => {
        let body = "";
        res.on("data", (c) => { body += String(c); });
        res.on("end", () => done(`${res.statusCode} ${body}`));
        setTimeout(() => done(String(res.statusCode)), 2000);
      });
      ws.on("error", () => done("error"));
      setTimeout(() => done("timeout"), 6000);
    });
  }

  test("没有名单时一切照旧", async () => {
    const url = await host(async () => ({ ok: true, list: [] }));
    expect(await tryConnect(url, "acct-1", newMachineId())).toBe("connected");
  }, 20_000);

  test("未被吊销的机器照常连上", async () => {
    const url = await host(async () => ({ ok: true, list: [{ accountId: "别人", machineId: "别的机器" }] }));
    expect(await tryConnect(url, "acct-1", newMachineId())).toBe("connected");
  }, 20_000);

  test("被吊销的机器 → 403 且信息含「已被吊销」", async () => {
    const machineId = newMachineId();
    const url = await host(async () => ({ ok: true, list: [{ accountId: "acct-1", machineId }] }));
    const outcome = await tryConnect(url, "acct-1", machineId);
    expect(outcome).toContain("403");
    expect(outcome).toContain("已被吊销");
  }, 20_000);

  test("跨账号不误伤:乙账号同 machineId 仍能连", async () => {
    const machineId = newMachineId();
    const url = await host(async () => ({ ok: true, list: [{ accountId: "acct-jia", machineId }] }));
    expect(await tryConnect(url, "acct-yi", machineId)).toBe("connected");
  }, 20_000);

  test("名单损坏 → 403(fail-closed),信息可辨认", async () => {
    const url = await host(async () => ({ ok: false, error: "吊销名单损坏" }));
    const outcome = await tryConnect(url, "acct-1", newMachineId());
    expect(outcome).toContain("403");
  }, 20_000);

  test("resolveRevocations 抛异常 → 403,绝不放行", async () => {
    const url = await host(async () => { throw new Error("读名单炸了"); });
    const outcome = await tryConnect(url, "acct-1", newMachineId());
    expect(outcome).not.toBe("connected");
    expect(outcome).toContain("403");
  }, 20_000);
});

describe("握手其余校验一条不破", () => {
  async function hostPlain(): Promise<string> {
    const server: Server = http.createServer((_req, res) => res.end("ok"));
    const endpoint = attachWorkerWebSocket(server, {
      resolveSecret: async () => SECRET,
      resolveRevocations: async () => ({ ok: true, list: [] }),
    } as never);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (typeof addr === "string" || addr === null) throw new Error("拿不到端口");
    cleanups.push(() => { endpoint.close(); server.close(); });
    return `ws://127.0.0.1:${addr.port}${WORKER_WS_PATH}`;
  }

  function probe(url: string, headers: Record<string, string>): Promise<string> {
    return new Promise((resolve) => {
      const ws = new WebSocket(url, { headers });
      cleanups.push(() => ws.close());
      let settled = false;
      const done = (v: string): void => { if (!settled) { settled = true; resolve(v); } };
      ws.on("open", () => { ws.close(); done("connected"); });
      ws.on("unexpected-response", (_r, res) => { res.resume(); done(String(res.statusCode)); });
      ws.on("error", () => done("error"));
      setTimeout(() => done("timeout"), 6000);
    });
  }

  test("带 Origin 仍然 403", async () => {
    const url = await hostPlain();
    expect(await probe(url, {
      Authorization: `Bearer ${signWorkerToken("a", newMachineId(), SECRET, Date.now())}`,
      "X-Kunpeng-Worker-Protocol": String(WORKER_PROTOCOL_VERSION),
      Origin: "https://evil.com",
    })).toBe("403");
  }, 20_000);

  test("无凭据仍然 401", async () => {
    const url = await hostPlain();
    expect(await probe(url, { "X-Kunpeng-Worker-Protocol": String(WORKER_PROTOCOL_VERSION) })).toBe("401");
  }, 20_000);

  test("协议版本不符仍然 426", async () => {
    const url = await hostPlain();
    expect(await probe(url, {
      Authorization: `Bearer ${signWorkerToken("a", newMachineId(), SECRET, Date.now())}`,
      "X-Kunpeng-Worker-Protocol": String(WORKER_PROTOCOL_VERSION + 99),
    })).toBe("426");
  }, 20_000);
});