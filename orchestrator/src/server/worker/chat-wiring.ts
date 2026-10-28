import { chmod, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { escHtml } from "../chat-sse.js";
import type { WorkerConnection } from "./worker-connections.js";
import { getWorkerEndpoint } from "./worker-runtime.js";

export const WORKER_MCP_SERVER_NAME = "kunpeng-worker";

interface AttachWorkerMcpOptions {
  accountId?: string;
  conv: string;
  baseUrl: string;
  token: string;
}

export function workerBannerHtml(machine: WorkerConnection | null): string {
  if (machine === null) {
    return '<div class="kp-ev kp-ev-error">没有在线工作机：kunpeng worker 未连接，agent 既不能动本机，也没有远端可用</div>';
  }
  return `<div class="kp-ev kp-ev-stage">已接入工作机：${escHtml(machine.machineName)} · ${escHtml(machine.root)}</div>`;
}

export function pickWorkerMachine(
  machines: readonly WorkerConnection[],
): WorkerConnection | null {
  let selected: WorkerConnection | null = null;
  for (const machine of machines) {
    if (selected === null || machine.connectedAt > selected.connectedAt) selected = machine;
  }
  return selected;
}

export function buildWorkerMcpServer(
  machine: Pick<WorkerConnection, "machineId">,
  conv: string,
  baseUrl: string,
  token: string,
): Record<string, { command: string; args: string[]; env: Record<string, string> }> {
  return {
    [WORKER_MCP_SERVER_NAME]: {
      command: process.execPath,
      args: [fileURLToPath(new URL("./mcp-server.js", import.meta.url))],
      env: {
        KUNPENG_WORKER_EXEC_URL: new URL("/api/worker/exec", baseUrl).toString(),
        KUNPENG_WORKER_FS_URL: new URL("/api/worker/fs", baseUrl).toString(),
        KUNPENG_WORKER_MACHINE_ID: machine.machineId,
        KUNPENG_WORKER_CONV: conv,
        KUNPENG_SESSION_TOKEN: token,
      },
    },
  };
}

export async function attachWorkerMcpToChatConfig(
  configPath: string,
  opts: AttachWorkerMcpOptions,
): Promise<WorkerConnection | null> {
  const endpoint = getWorkerEndpoint();
  if (endpoint === null || !opts.accountId) return null;

  const machine = pickWorkerMachine(endpoint.registry.listByAccount(opts.accountId));
  if (machine === null) return null;

  const parsed: unknown = JSON.parse(await readFile(configPath, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`对话 MCP 配置非法: ${configPath}`);
  }
  const config = parsed as Record<string, unknown>;
  const currentServers = config.mcpServers;
  const mcpServers = currentServers !== null
    && typeof currentServers === "object"
    && !Array.isArray(currentServers)
    ? currentServers as Record<string, unknown>
    : {};
  const merged = {
    ...config,
    mcpServers: {
      ...mcpServers,
      ...buildWorkerMcpServer(machine, opts.conv, opts.baseUrl, opts.token),
    },
  };
  await writeFile(configPath, `${JSON.stringify(merged, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(configPath, 0o600);
  return machine;
}
