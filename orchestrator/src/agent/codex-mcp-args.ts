import { isRecord } from "../util/is-record.js";
import { readFileSync } from "node:fs";

const BARE_KEY = /^[A-Za-z0-9_-]+$/;

function appendConfig(args: string[], expression: string): void {
  args.push("-c", expression);
}

function inlineTable(value: Record<string, unknown>): string {
  return Object.entries(value)
    .filter(([key]) => BARE_KEY.test(key))
    .map(([key, entry]) => `${key}=${JSON.stringify(entry)}`)
    .join(",");
}

export function codexMcpArgs(mcpConfigPath?: string): string[] {
  if (!mcpConfigPath) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(mcpConfigPath, "utf8"));
  } catch {
    return [];
  }

  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) return [];

  const args: string[] = [];
  for (const [name, value] of Object.entries(parsed.mcpServers)) {
    if (!BARE_KEY.test(name) || !isRecord(value)) continue;

    if (typeof value.command === "string") {
      appendConfig(args, `mcp_servers.${name}.command=${JSON.stringify(value.command)}`);
      if (Array.isArray(value.args)) {
        appendConfig(args, `mcp_servers.${name}.args=[${value.args.map((entry) => JSON.stringify(entry)).join(",")}]`);
      }
      if (isRecord(value.env)) {
        appendConfig(args, `mcp_servers.${name}.env={${inlineTable(value.env)}}`);
      }
      continue;
    }

    if (typeof value.url === "string" && value.command === undefined) {
      appendConfig(args, `mcp_servers.${name}.url=${JSON.stringify(value.url)}`);
      if (isRecord(value.headers)) {
        appendConfig(args, `mcp_servers.${name}.http_headers={${inlineTable(value.headers)}}`);
      }
    }
  }

  return args;
}
