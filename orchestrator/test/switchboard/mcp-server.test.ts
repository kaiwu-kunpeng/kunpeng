import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleMcpRequest, TOOL_DEFS, type JsonRpcRequest } from "../../src/switchboard/mcp-server.js";
import { TaskStore } from "../../src/switchboard/task-store.js";
import { PresenceStore } from "../../src/switchboard/presence.js";

let dir: string;
let taskStore: TaskStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kp-mcp-"));
  taskStore = new TaskStore(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const req = (method: string, params?: unknown, id: number | string = 1): JsonRpcRequest => ({
  jsonrpc: "2.0", id, method, params,
});
type InitializeResult = { serverInfo: { name: string }; protocolVersion: string };
type ToolListResult = { tools: Array<{ name: string }> };
type ToolCallResult = { content: Array<{ text: string }>; isError?: boolean };
type TaskResult = { id: string; status: { state: string } };

describe("switchboard MCP server (零依赖手写 JSON-RPC)", () => {
  it("initialize 返回 protocolVersion + serverInfo", async () => {
    const r = await handleMcpRequest(req("initialize", { protocolVersion: "2024-11-05" }), { taskStore });
    expect((r?.result as InitializeResult).serverInfo.name).toBe("kunpeng-switchboard");
    expect((r?.result as InitializeResult).protocolVersion).toBeTruthy();
  });

  it("notifications/initialized 是通知, 无响应(null)", async () => {
    const r = await handleMcpRequest({ jsonrpc: "2.0", method: "notifications/initialized" }, { taskStore });
    expect(r).toBeNull();
  });

  it("tools/list 列出 task_create/task_get/task_cancel 等", async () => {
    const r = await handleMcpRequest(req("tools/list"), { taskStore });
    const names = (r?.result as ToolListResult).tools.map((tool) => tool.name);
    expect(names).toContain("task_create");
    expect(names).toContain("task_get");
    expect(names).toContain("task_cancel");
    expect(TOOL_DEFS.length).toBeGreaterThanOrEqual(5);
  });

  it("tools/call 真往返: create→submitted, cancel→canceled", async () => {
    const created = await handleMcpRequest(
      req("tools/call", { name: "task_create", arguments: { from: "main", to: "all", body: "做任务" } }),
      { taskStore },
    );
    const task = JSON.parse((created?.result as ToolCallResult).content[0].text) as TaskResult;
    expect(task.status.state).toBe("submitted");

    const cancelled = await handleMcpRequest(
      req("tools/call", { name: "task_cancel", arguments: { taskId: task.id, from: "main", to: "all", reason: "停" } }),
      { taskStore },
    );
    expect((cancelled?.result as ToolCallResult).isError).toBeFalsy();

    const got = await handleMcpRequest(
      req("tools/call", { name: "task_get", arguments: { taskId: task.id } }),
      { taskStore },
    );
    const after = JSON.parse((got?.result as ToolCallResult).content[0].text) as TaskResult;
    expect(after.status.state).toBe("canceled");
  });

  it("tools/call 未知工具 → isError 结果(不抛)", async () => {
    const r = await handleMcpRequest(req("tools/call", { name: "nope", arguments: {} }), { taskStore });
    expect((r?.result as ToolCallResult).isError).toBe(true);
  });

  it("未知 method → JSON-RPC error -32601", async () => {
    const r = await handleMcpRequest(req("bogus/method"), { taskStore });
    expect(r?.error?.code).toBe(-32601);
  });

  it("agent_list 经 presence 真往返", async () => {
    const presence = new PresenceStore(join(dir, "presence"));
    await presence.beat("worker-1", Date.now());
    const r = await handleMcpRequest(req("tools/call", { name: "agent_list", arguments: {} }), { taskStore, presence });
    const agents = JSON.parse((r?.result as ToolCallResult).content[0].text) as Array<{ instance: string }>;
    expect(agents.some((agent) => agent.instance === "worker-1")).toBe(true);
  });
});
