import { listMcpServers, mcpRoot } from "../../mcp/registry.js";
import { listPlugins, pluginsRoot } from "../../plugin/store.js";
import { escHtml } from "../../util/esc-html.js";
import { registerModularRoute } from "./registry.js";

export interface PluginsPageData {
  plugins: { name: string; version: string; enabled: boolean; dir: string; skills: number; mcp: number }[];
  servers: { id: string; name?: string; transport: string; enabled: boolean; origin?: string; detail: string }[];
}

function text(value: string | undefined, fallback = "—"): string {
  return escHtml(value ?? fallback);
}

function status(enabled: boolean): string {
  return `<span class="${enabled ? "ok" : "off"}">${escHtml(enabled ? "启用" : "停用")}</span>`;
}

function renderPluginsTable(plugins: PluginsPageData["plugins"]): string {
  if (plugins.length === 0) {
    return `<div class="empty"><p>尚未安装插件。运行 <code>kunpeng plugin add</code> 添加插件后再刷新本页。</p></div>`;
  }

  return `<div class="table-wrap"><table>
    <thead><tr><th>名称</th><th>版本</th><th>启用</th><th>目录</th><th>技能数</th><th>MCP 数</th></tr></thead>
    <tbody>${plugins.map((plugin) => `<tr>
      <td><code>${escHtml(plugin.name)}</code></td>
      <td>${escHtml(plugin.version)}</td>
      <td>${status(plugin.enabled)}</td>
      <td><code>${escHtml(plugin.dir)}</code></td>
      <td>${escHtml(String(plugin.skills))}</td>
      <td>${escHtml(String(plugin.mcp))}</td>
    </tr>`).join("")}</tbody>
  </table></div>`;
}

function renderServersTable(servers: PluginsPageData["servers"]): string {
  if (servers.length === 0) {
    return `<div class="empty"><p>尚未配置 MCP server。运行 <code>kunpeng mcp add</code> 添加后再刷新本页。</p></div>`;
  }

  return `<div class="table-wrap"><table>
    <thead><tr><th>ID</th><th>名称</th><th>transport</th><th>启用</th><th>来源</th><th>详情</th></tr></thead>
    <tbody>${servers.map((server) => `<tr>
      <td><code>${escHtml(server.id)}</code></td>
      <td>${text(server.name)}</td>
      <td>${escHtml(server.transport)}</td>
      <td>${status(server.enabled)}</td>
      <td>${text(server.origin)}</td>
      <td><code>${escHtml(server.detail)}</code></td>
    </tr>`).join("")}</tbody>
  </table></div>`;
}

export function renderPluginsPage(data: PluginsPageData): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>鲲鹏插件与 MCP</title>
  <style>
    :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;color:#1f2937;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;line-height:1.7}main{max-width:1120px;margin:0 auto;padding:32px 24px 64px}h1{margin:0 0 8px;color:#111827}h2{margin:28px 0 12px;color:#1e293b}.lead{margin:0 0 28px;color:#64748b}.table-wrap{overflow:auto;border:1px solid #dbe3ec;border-radius:10px;background:#fff}table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:13px 16px;border-bottom:1px solid #e5e7eb;vertical-align:top}th{color:#475569;background:#f1f5f9;font-size:13px;white-space:nowrap}tbody tr:last-child td{border-bottom:0}code{padding:.12em .35em;border-radius:4px;background:#eef2f7;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}.ok{color:#15803d;font-weight:700}.off{color:#64748b;font-weight:700}.empty{padding:18px 22px;border:1px solid #dbe3ec;border-radius:10px;background:#fff}.empty p{margin:0}footer{margin-top:30px;padding-top:18px;border-top:1px solid #dbe3ec;color:#475569}footer p{margin:.5em 0}a{color:#2563eb;text-decoration:none}a:hover{text-decoration:underline}
  </style>
</head>
<body><main>
  <h1>插件与 MCP</h1>
  <p class="lead">只读查看已安装插件和 MCP server；管理操作请使用命令行。</p>
  <section><h2>插件</h2>${renderPluginsTable(data.plugins)}</section>
  <section><h2>MCP server</h2>${renderServersTable(data.servers)}</section>
  <footer>
    <p>管理命令：<code>kunpeng plugin …</code>、<code>kunpeng mcp …</code>；改动后运行 <code>kunpeng mcp sync</code>。</p>
    <p><a href="/help?page=02-user-guide/plugins-skills-mcp.md">查看插件、技能与 MCP 文档</a> · <a href="/">返回总控台 /</a></p>
  </footer>
</main></body>
</html>`;
}

async function collectPluginsPageData(): Promise<PluginsPageData> {
  let plugins: PluginsPageData["plugins"];
  try {
    const records = await listPlugins(pluginsRoot());
    plugins = records.map((record) => ({
      name: record.name,
      version: record.version,
      enabled: record.enabled,
      dir: record.dir,
      skills: record.skills?.length ?? 0,
      mcp: record.mcpIds?.length ?? 0,
    }));
  } catch {
    plugins = [];
  }

  let servers: PluginsPageData["servers"];
  try {
    const records = await listMcpServers(mcpRoot());
    servers = records.map((record) => ({
      id: record.id,
      ...(record.name !== undefined && { name: record.name }),
      transport: record.transport,
      enabled: record.enabled,
      ...(record.origin !== undefined && { origin: record.origin }),
      detail: record.transport === "stdio" ? (record.command ?? "—") : (record.url ?? "—"),
    }));
  } catch {
    servers = [];
  }

  return { plugins, servers };
}

registerModularRoute({
  method: "GET",
  path: "/plugins",
  handle: async (_req, res) => {
    const data = await collectPluginsPageData();
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderPluginsPage(data));
  },
});
