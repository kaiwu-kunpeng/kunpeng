import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { switchboardMcpDeps } from "../../src/switchboard/mcp-wiring.js";
import { handleMcpRequest } from "../../src/switchboard/mcp-server.js";

let stateDir: string;
type ToolCallResult = { content: Array<{ text: string }> };
type TaskResult = { id: string; status: { state: string } };

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "kp-mcpwire-"));
});
afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

describe("switchboardMcpDeps 接线到真状态目录", () => {
  it("经 deps 建的任务真落在 <stateDir>/switchboard", async () => {
    const deps = switchboardMcpDeps(stateDir);
    const task = await deps.taskStore.createTask({ from: "main", to: "all", body: "经接线建任务" });
    expect(task.status.state).toBe("submitted");
    const files = await readdir(join(stateDir, "switchboard"));
    expect(files.some((f) => f.endsWith(".json"))).toBe(true);
  });

  it("presence 接到 <stateDir>/presence", async () => {
    const deps = switchboardMcpDeps(stateDir);
    expect(deps.presence).toBeDefined();
    await deps.presence!.beat("worker-1", 1700000000000);
    const files = await readdir(join(stateDir, "presence"));
    expect(files.length).toBeGreaterThan(0);
  });

  it("deps 可直接喂 handleMcpRequest 真往返(create→get→canceled)", async () => {
    const deps = switchboardMcpDeps(stateDir);
    const created = await handleMcpRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "task_create", arguments: { from: "main", to: "all", body: "x" } } },
      deps,
    );
    const task = JSON.parse((created?.result as ToolCallResult).content[0].text) as TaskResult;
    await handleMcpRequest(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "task_cancel", arguments: { taskId: task.id, from: "main", to: "all" } } },
      deps,
    );
    const got = await handleMcpRequest(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "task_get", arguments: { taskId: task.id } } },
      deps,
    );
    const after = JSON.parse((got?.result as ToolCallResult).content[0].text) as TaskResult;
    expect(after.status.state).toBe("canceled");
  });
});
