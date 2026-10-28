import { isRecord } from "../../util/is-record.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SkillEntry } from "../../skills/registry.js";

export interface LocalFsMcpConfig {
  mcpServers: {
    localfs: {
      command: string;
      args: string[];
      env: {
        KP_LOCALFS_CONV: string;
        KP_LOCALFS_ENQUEUE_URL: string;
        KP_LOCALFS_TOKEN: string;
      };
    };
  };
}

type McpServers = Record<string, unknown>;

const SWITCHBOARD_MCP_NAME = "switchboard-mcp";
const KUNPENG_CLI_JS = fileURLToPath(new URL("../../cli.js", import.meta.url));

export const BUILTIN_MCP_SERVERS = {
  fetch: { command: "uvx", args: ["mcp-server-fetch"] },
  [SWITCHBOARD_MCP_NAME]: { command: process.execPath, args: [KUNPENG_CLI_JS, "switchboard-mcp"] },
  memory: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] },
  "sequential-thinking": { command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"] },
  time: { command: "uvx", args: ["mcp-server-time"] },
} as const satisfies Record<string, { command: string; args: readonly string[] }>;

export interface MergedMcpConfig {
  mcpServers: McpServers;
}

export function chatMcpAllowlist(env: NodeJS.ProcessEnv): string[] {
  const raw = env.KP_CHAT_MCP;
  if (!raw) return ["xcrawl"];
  const names = raw.split(",").map((name) => name.trim()).filter(Boolean);
  return names.length ? names : ["xcrawl"];
}

/** 已启用技能声明的 MCP 名字:扁平化、去重、保持首次出现顺序。 */
export function skillDeclaredMcpNames(entries: readonly SkillEntry[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const entry of entries) {
    if (entry.enabled === false) continue;
    for (const name of entry.requiresMcp ?? []) {
      if (seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/** 对话面的 MCP 白名单必带总机；已有则保持原序并返回副本。 */
export function withSwitchboardMcp(names: readonly string[]): string[] {
  return names.includes(SWITCHBOARD_MCP_NAME) ? [...names] : [...names, SWITCHBOARD_MCP_NAME];
}

/** 环境变量白名单在前,技能声明的 MCP 补在后;去重、保序。 */
export function chatMcpNames(env: NodeJS.ProcessEnv, entries: readonly SkillEntry[]): string[] {
  const names = [...chatMcpAllowlist(env)];
  const seen = new Set(names);
  for (const name of skillDeclaredMcpNames(entries)) {
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

export function readGlobalMcpServers(path: string): McpServers {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(parsed)) return {};
    const servers = parsed.mcpServers;
    if (!isRecord(servers) || Object.keys(servers).length === 0) return {};
    return servers;
  } catch {
    return {};
  }
}

export function mergeAllowedMcpServers(
  base: { mcpServers: McpServers },
  globalServers: McpServers,
  allowlist: readonly string[],
): MergedMcpConfig {
  const mcpServers: McpServers = { ...base.mcpServers };
  for (const name of allowlist) {
    if (name === "localfs") continue;
    if (Object.prototype.hasOwnProperty.call(globalServers, name)) {
      mcpServers[name] = globalServers[name];
    } else if (Object.prototype.hasOwnProperty.call(BUILTIN_MCP_SERVERS, name)) {
      mcpServers[name] = BUILTIN_MCP_SERVERS[name as keyof typeof BUILTIN_MCP_SERVERS];
    }
  }
  if (Object.prototype.hasOwnProperty.call(base.mcpServers, "localfs")) {
    mcpServers.localfs = base.mcpServers.localfs;
  }
  return { mcpServers };
}

function escHtmlAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function localFsConvFrame(conv: string): string {
  const safeConv = escHtmlAttr(conv);
  return `<div class="kp-localfs-conv" data-conv="${safeConv}"></div>`;
}

export function buildLocalFsMcpConfig(conv: string, baseUrl: string, token = ""): LocalFsMcpConfig {
  const enqueueUrl = new URL("/api/localfs/enqueue", baseUrl);
  return {
    mcpServers: {
      localfs: {
        command: process.execPath,
        args: [fileURLToPath(new URL("./mcp-server.js", import.meta.url))],
        env: {
          KP_LOCALFS_CONV: conv,
          KP_LOCALFS_ENQUEUE_URL: enqueueUrl.toString(),
          // 当前用户会话 token,供 mcp-server enqueue 时带 cookie 穿透鉴权门(无鉴权时为空串)。
          KP_LOCALFS_TOKEN: token,
        },
      },
    },
  };
}
