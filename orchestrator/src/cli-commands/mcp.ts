import { lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  buildMcpBaseConfig,
  listMcpServers,
  mcpRoot,
  registerMcpServer,
  removeMcpServer,
  setMcpEnabled,
  type McpEntry,
} from "../mcp/registry.js";
import { sharedDir } from "../project/profile.js";
import { registerCliCommand, type CliContext } from "./registry.js";

const USAGE = [
  "用法: kunpeng mcp <list|add|remove|enable|disable|sync> ...",
  "  kunpeng mcp add <id> (--url <url> | --command <bin>) [--arg <v> ...] [--name <名>]",
  "    [--env K=V ...] [--header K=V ...] [--disabled]",
  "  kunpeng mcp sync [--refresh]",
  '凭证纪律: --env / --header 的值建议使用 "${VAR}" 占位，真实密钥放环境变量，不落注册表。',
].join("\n");

export async function syncMcpBase(
  root: string,
  sharedPath: string,
): Promise<{ path: string; count: number }> {
  const entries = await listMcpServers(root);
  const config = buildMcpBaseConfig(entries);
  await mkdir(dirname(sharedPath), { recursive: true });
  await writeFile(sharedPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { path: sharedPath, count: Object.keys(config.mcpServers).length };
}

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

function positional(context: CliContext): string[] {
  return context.rest.filter((token) => !token.startsWith("--"));
}

function optionValues(argv: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== flag) continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} 缺少值`);
    }
    values.push(value);
    index += 1;
  }
  return values;
}

function optionValue(argv: string[], flag: string): string | undefined {
  const values = optionValues(argv, flag);
  return values.at(-1);
}

function keyValueOptions(argv: string[], flag: string): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  const values = optionValues(argv, flag);
  for (const value of values) {
    const separator = value.indexOf("=");
    if (separator <= 0) throw new Error(`${flag} 必须使用 K=V 格式`);
    result[value.slice(0, separator)] = value.slice(separator + 1);
  }
  return values.length > 0 ? result : undefined;
}

async function listServers(root: string): Promise<void> {
  const servers = await listMcpServers(root);
  if (servers.length === 0) {
    console.log("(无 MCP server) 用 kunpeng mcp add <id> --command <bin> 或 --url <url> 添加");
    return;
  }
  console.table(servers.map((server) => ({
    id: server.id,
    名称: server.name ?? "—",
    transport: server.transport,
    enabled: server.enabled,
    来源: server.origin ?? "—",
    详情: server.transport === "stdio" ? server.command ?? "—" : server.url ?? "—",
  })));
}

async function addServer(context: CliContext, root: string, id: string | undefined): Promise<void> {
  if (!id) throw new Error(`MCP server id 必填\n${USAGE}`);
  const url = optionValue(context.argv, "--url");
  const command = optionValue(context.argv, "--command");
  if (url !== undefined && command !== undefined) {
    throw new Error("--url 与 --command 只能选择一个");
  }

  const transport: McpEntry["transport"] = url !== undefined ? "http" : "stdio";
  const args = optionValues(context.argv, "--arg");
  const env = keyValueOptions(context.argv, "--env");
  const headers = keyValueOptions(context.argv, "--header");
  const name = optionValue(context.argv, "--name");
  const entry: McpEntry = {
    id,
    transport,
    enabled: !context.argv.includes("--disabled"),
    origin: "user",
    ...(name !== undefined && { name }),
    ...(command !== undefined && { command }),
    ...(args.length > 0 && { args }),
    ...(env !== undefined && { env }),
    ...(url !== undefined && { url }),
    ...(headers !== undefined && { headers }),
  };
  await registerMcpServer(root, entry);
  console.log(`[MCP] 已添加 ${id}`);
}

async function refreshProfileMcpConfigs(): Promise<number> {
  const profilesRoot = join(dirname(sharedDir()), "profiles");
  let profiles;
  try {
    profiles = await readdir(profilesRoot, { withFileTypes: true });
  } catch (error: unknown) {
    if (isEnoent(error)) return 0;
    throw error;
  }

  let removed = 0;
  for (const profile of profiles) {
    if (!profile.isDirectory()) continue;
    const path = join(profilesRoot, profile.name, "mcp.json");
    try {
      await lstat(path);
    } catch (error: unknown) {
      if (isEnoent(error)) continue;
      throw error;
    }
    await rm(path, { force: true });
    removed += 1;
  }
  return removed;
}

async function syncServers(context: CliContext, root: string): Promise<void> {
  const result = await syncMcpBase(root, join(sharedDir(), "mcp-base.json"));
  console.log(`[MCP] 已写入 ${result.path}，生效 ${result.count} 条`);
  console.log("per-profile mcp.json 由下次运行惰性生成");
  if (context.argv.includes("--refresh")) {
    const removed = await refreshProfileMcpConfigs();
    console.log(`[MCP] 已删除 ${removed} 个 per-profile mcp.json`);
  }
}

async function run(context: CliContext): Promise<void> {
  const [subcommand, id] = positional(context);
  if (!subcommand || !["list", "add", "remove", "enable", "disable", "sync"].includes(subcommand)) {
    fail(USAGE);
    return;
  }

  const root = mcpRoot();
  try {
    if (subcommand === "list") await listServers(root);
    else if (subcommand === "add") await addServer(context, root, id);
    else if (subcommand === "remove") {
      if (!id) throw new Error("MCP server id 必填");
      await removeMcpServer(root, id);
      console.log(`[MCP] 已移除 ${id}`);
    } else if (subcommand === "enable" || subcommand === "disable") {
      if (!id) throw new Error("MCP server id 必填");
      await setMcpEnabled(root, id, subcommand === "enable");
      console.log(`[MCP] 已${subcommand === "enable" ? "启用" : "禁用"} ${id}`);
    } else {
      await syncServers(context, root);
    }
  } catch (error: unknown) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function isEnoent(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

registerCliCommand({ name: "mcp", run });
