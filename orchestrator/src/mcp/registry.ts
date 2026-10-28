import { isRecord } from "../util/is-record.js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { McpConfig, McpServerConfig } from "../project/mcp-generator.js";
import { DEFAULT_MANAGED_CREDENTIAL_ENV_KEYS } from "../project/profile-env-builder.js";
import type { ManagedCredentialEnvKey } from "../project/profile-env-builder.js";
import { kunpengStateDir } from "../project/state-dir.js";
import { isNodeError } from "../util/errors.js";

export interface McpEntry {
  id: string;
  name?: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  origin?: "builtin" | "user" | "plugin";
  notes?: string;
}

interface McpIndex {
  servers: McpEntry[];
}

let temporaryFileSequence = 0;

export function mcpRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(kunpengStateDir(env), "mcp");
}

export async function listMcpServers(root: string): Promise<McpEntry[]> {
  return readIndex(root);
}

export async function registerMcpServer(root: string, entry: McpEntry): Promise<void> {
  validateEntry(entry);

  const servers = await readIndex(root);
  const existingIndex = servers.findIndex((server) => server.id === entry.id);
  if (existingIndex >= 0) {
    servers[existingIndex] = entry;
  } else {
    servers.push(entry);
  }
  await writeIndex(root, servers);
}

export async function removeMcpServer(root: string, id: string): Promise<void> {
  const servers = await readIndex(root);
  const index = servers.findIndex((server) => server.id === id);
  if (index < 0) {
    throw new Error(`未找到 MCP server: ${id}`);
  }

  servers.splice(index, 1);
  await writeIndex(root, servers);
}

export async function setMcpEnabled(root: string, id: string, enabled: boolean): Promise<void> {
  const servers = await readIndex(root);
  const index = servers.findIndex((server) => server.id === id);
  if (index < 0) {
    throw new Error(`未找到 MCP server: ${id}`);
  }

  const server = servers[index];
  if (server === undefined) {
    throw new Error(`未找到 MCP server: ${id}`);
  }
  servers[index] = { ...server, enabled };
  await writeIndex(root, servers);
}

export function buildMcpBaseConfig(entries: McpEntry[]): McpConfig {
  const mcpServers: Record<string, McpServerConfig> = {};

  for (const entry of entries) {
    if (entry.enabled !== true) continue;

    const server: McpServerConfig = {};
    if (entry.command !== undefined) server.command = entry.command;
    if (entry.args !== undefined) server.args = [...entry.args];
    if (entry.env !== undefined) {
      // 插件条目先剥掉受管凭据键，避免生成 profile 配置时注入宿主凭据。
      const env = entry.origin === "plugin" ? stripManagedCredentialEnv(entry.env) : { ...entry.env };
      if (entry.origin !== "plugin" || Object.keys(env).length > 0) server.env = env;
    }
    if (entry.url !== undefined) server.url = entry.url;
    if (entry.headers !== undefined) server.headers = { ...entry.headers };
    mcpServers[entry.id] = server;
  }

  return { mcpServers };
}

/** 去掉受管凭据键，其余 env 原样保留。 */
export function stripManagedCredentialEnv(
  env: Record<string, string>,
  managedKeys: readonly ManagedCredentialEnvKey[] = DEFAULT_MANAGED_CREDENTIAL_ENV_KEYS,
): Record<string, string> {
  const blocked = new Set<string>(managedKeys);
  return Object.fromEntries(Object.entries(env).filter(([key]) => !blocked.has(key)));
}

function indexPath(root: string): string {
  return join(root, "index.json");
}

async function readIndex(root: string): Promise<McpEntry[]> {
  const path = indexPath(root);
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const parsed: unknown = JSON.parse(contents);
  if (!isRecord(parsed) || !Array.isArray(parsed.servers)) {
    throw new TypeError(`MCP index must contain a servers array: ${path}`);
  }
  return parsed.servers as McpEntry[];
}

async function writeIndex(root: string, servers: McpEntry[]): Promise<void> {
  await mkdir(root, { recursive: true });
  const path = indexPath(root);
  temporaryFileSequence += 1;
  const temporaryPath = `${path}.tmp-${process.pid}-${temporaryFileSequence}`;
  const index: McpIndex = { servers };
  await writeFile(temporaryPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

function validateEntry(entry: McpEntry): void {
  if (!/^[A-Za-z0-9_-]+$/.test(entry.id)) {
    throw new Error(`非法 MCP server id: ${entry.id}`);
  }
  if (entry.transport === "stdio" && !entry.command?.trim()) {
    throw new Error(`stdio MCP server 缺少 command: ${entry.id}`);
  }
  if (entry.transport === "http" && !entry.url?.trim()) {
    throw new Error(`http MCP server 缺少 url: ${entry.id}`);
  }
}
