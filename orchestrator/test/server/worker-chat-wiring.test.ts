import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  attachWorkerMcpToChatConfig,
  buildWorkerMcpServer,
  pickWorkerMachine,
  WORKER_MCP_SERVER_NAME,
} from "../../src/server/worker/chat-wiring.js";
import { setWorkerEndpoint } from "../../src/server/worker/worker-runtime.js";
import type { WorkerConnection } from "../../src/server/worker/worker-connections.js";
import { writeChatModeSettings } from "../../src/server/chat-stream.js";
import { handleWorkspaceRoute } from "../../src/server/workspace-route.js";

function machine(over: Partial<WorkerConnection> = {}): WorkerConnection {
  return {
    connId: "c1",
    accountId: "acct-1",
    machineId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    machineName: "笔记本",
    root: "/work",
    connectedAt: 1000,
    ...over,
  };
}

function stubEndpoint(machines: WorkerConnection[]): void {
  setWorkerEndpoint({
    registry: { listByAccount: () => machines },
  } as unknown as Parameters<typeof setWorkerEndpoint>[0]);
}

let dir = "";
const savedState = process.env.KUNPENG_STATE;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kp-worker-wiring-"));
  process.env.KUNPENG_STATE = join(dir, "state");
});

afterEach(async () => {
  setWorkerEndpoint(null);
  if (savedState === undefined) delete process.env.KUNPENG_STATE;
  else process.env.KUNPENG_STATE = savedState;
  await rm(dir, { recursive: true, force: true });
});

describe("pickWorkerMachine", () => {
  test("没有在线工作机时返回 null", () => {
    expect(pickWorkerMachine([])).toBeNull();
  });

  test("多台在线时取最近接入的那台", () => {
    const older = machine({ connId: "old", machineId: "b".repeat(32), connectedAt: 10 });
    const newer = machine({ connId: "new", machineId: "c".repeat(32), connectedAt: 99 });
    expect(pickWorkerMachine([older, newer])?.machineId).toBe("c".repeat(32));
    expect(pickWorkerMachine([newer, older])?.machineId).toBe("c".repeat(32));
  });
});

describe("buildWorkerMcpServer", () => {
  test("env 齐五项、命令指向 worker 自己的 mcp-server", () => {
    const spec = buildWorkerMcpServer(machine(), "conv-x", "http://127.0.0.1:7788", "tok-1");
    const entry = spec[WORKER_MCP_SERVER_NAME];
    expect(entry.args[0].endsWith("/worker/mcp-server.js")).toBe(true);
    expect(entry.env.KUNPENG_WORKER_EXEC_URL).toBe("http://127.0.0.1:7788/api/worker/exec");
    expect(entry.env.KUNPENG_WORKER_FS_URL).toBe("http://127.0.0.1:7788/api/worker/fs");
    expect(entry.env.KUNPENG_WORKER_MACHINE_ID).toBe("a".repeat(32));
    expect(entry.env.KUNPENG_WORKER_CONV).toBe("conv-x");
    expect(entry.env.KUNPENG_SESSION_TOKEN).toBe("tok-1");
  });
});

describe("attachWorkerMcpToChatConfig", () => {
  test("有在线工作机时并进配置且保留 localfs，权限 0600", async () => {
    const cfgPath = join(dir, "conv.mcp.json");
    await writeFile(cfgPath, JSON.stringify({ mcpServers: { localfs: { command: "node" } } }), { mode: 0o600 });
    stubEndpoint([machine()]);

    const picked = await attachWorkerMcpToChatConfig(cfgPath, {
      accountId: "acct-1",
      conv: "conv-y",
      baseUrl: "http://127.0.0.1:7788",
      token: "tok-2",
    });

    expect(picked?.machineName).toBe("笔记本");
    const written = JSON.parse(await readFile(cfgPath, "utf8")) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(written.mcpServers).sort()).toEqual([WORKER_MCP_SERVER_NAME, "localfs"].sort());
    expect((await stat(cfgPath)).mode & 0o777).toBe(0o600);
  });

  test("没有在线工作机时返回 null 且一个字节都不改", async () => {
    const cfgPath = join(dir, "conv2.mcp.json");
    const before = JSON.stringify({ mcpServers: { localfs: { command: "node" } } });
    await writeFile(cfgPath, before, { mode: 0o600 });
    stubEndpoint([]);

    const picked = await attachWorkerMcpToChatConfig(cfgPath, {
      accountId: "acct-1",
      conv: "conv-z",
      baseUrl: "http://127.0.0.1:7788",
      token: "tok-3",
    });

    expect(picked).toBeNull();
    expect(await readFile(cfgPath, "utf8")).toBe(before);
  });

  test("没有账号上下文时不接工作机", async () => {
    const cfgPath = join(dir, "conv3.mcp.json");
    const before = JSON.stringify({ mcpServers: {} });
    await writeFile(cfgPath, before, { mode: 0o600 });
    stubEndpoint([machine()]);

    const picked = await attachWorkerMcpToChatConfig(cfgPath, {
      conv: "conv-w",
      baseUrl: "http://127.0.0.1:7788",
      token: "tok-4",
    });

    expect(picked).toBeNull();
    expect(await readFile(cfgPath, "utf8")).toBe(before);
  });
});

describe("writeChatModeSettings 每会话一份", () => {
  test("两个会话写出两份互不覆盖的文件，且都不在仓库工作树里", async () => {
    const a = await writeChatModeSettings("conv-aaa", "trip", "full");
    const b = await writeChatModeSettings("conv-bbb", "full", "isolated");
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
    expect(a).toContain("conv-aaa");
    expect(b).toContain("conv-bbb");
    expect(a).toContain(process.env.KUNPENG_STATE as string);
    expect(existsSync(join(process.cwd(), ".kunpeng", "chat-mode-settings.json"))).toBe(false);

    const denyA = JSON.parse(await readFile(a as string, "utf8")) as { permissions: { deny: string[] } };
    const denyB = JSON.parse(await readFile(b as string, "utf8")) as { permissions: { deny: string[] } };
    expect(denyA.permissions.deny).toEqual(["Bash", "Edit", "NotebookEdit", "Write"]);
    expect(denyB.permissions.deny).toEqual(["Bash", "Edit", "NotebookEdit", "Read", "Write"]);
  });

  test("满血 + 上限 full 依旧不写文件、不传 --settings", async () => {
    expect(await writeChatModeSettings("conv-ccc", "full", "full")).toBeUndefined();
  });
});

describe("未开鉴权时不把对话降级成 isolated", () => {
  test("无鉴权上下文 → hostCeiling 为 full", async () => {
    const captured: Array<{ workMode?: string; hostCeiling?: string }> = [];
    const req = Object.assign(
      new Readable({ read() { this.push(JSON.stringify({ msg: "hi", workMode: "full" })); this.push(null); } }),
      { method: "POST", url: "/api/workspace/w1/chat", headers: { host: "127.0.0.1" } },
    );
    const res = { writeHead() {}, end() {}, write() {}, setHeader() {}, headersSent: false };

    const handled = await handleWorkspaceRoute(
      "POST",
      "/api/workspace/w1/chat",
      req as unknown as Parameters<typeof handleWorkspaceRoute>[2],
      res as unknown as Parameters<typeof handleWorkspaceRoute>[3],
      {
        resolveCwd: async () => dir,
        streamChat: async (...args: unknown[]) => {
          const deps = args[7] as { workMode?: string; hostCeiling?: string };
          captured.push({ workMode: deps.workMode, hostCeiling: deps.hostCeiling });
        },
      } as unknown as Parameters<typeof handleWorkspaceRoute>[4],
    );

    expect(handled).toBe(true);
    expect(captured).toEqual([{ workMode: "full", hostCeiling: "full" }]);
  });
});