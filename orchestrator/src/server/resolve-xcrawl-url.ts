import { readFileSync } from "node:fs";

// 从 Claude 配置(~/.claude.json)解析 xcrawl MCP 的 url：mcpServers.xcrawl.url。
// 读不到 / 解析失败 / 字段缺失 → 返回 undefined（best-effort，绝不抛）。
export function resolveXcrawlMcpUrl(
  configPath: string,
  readFileImpl: (p: string, enc: "utf8") => string = readFileSync,
): string | undefined {
  try {
    const raw = readFileImpl(configPath, "utf8");
    const json = JSON.parse(raw) as { mcpServers?: Record<string, { url?: unknown }> };
    const url = json.mcpServers?.xcrawl?.url;
    return typeof url === "string" && url.length > 0 ? url : undefined;
  } catch {
    return undefined;
  }
}
