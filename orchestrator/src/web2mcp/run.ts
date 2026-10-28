import { FormDiscoverer } from "./form-discoverer.js";
import { NetworkDiscoverer } from "./network-discoverer.js";
import { emitMcpServer } from "./generator.js";
import type { ActionDiscoverer, ActionSpec, DiscoverOpts, PageProvider, Web2McpResult } from "./types.js";

/** web2mcp 命令的可测编排：发现动作→去重→生成 MCP 工程。CLI 只做参数解析/日志/exit。 */
export interface Web2McpRunOpts {
  url: string;
  outDir: string;
  discover?: "form" | "network" | "both";
  storageStatePath?: string;
  maxActions?: number;
  /** 注入给 discoverer 的 PageProvider（测试用 Fake，免开真浏览器）。 */
  pageProvider?: PageProvider;
  /** 直接注入 discoverer（测试优先）；缺省按 discover 构造真实 Form/Network。 */
  discoverers?: ActionDiscoverer[];
}

function buildDiscoverers(which: "form" | "network" | "both"): ActionDiscoverer[] {
  const ds: ActionDiscoverer[] = [];
  if (which === "form" || which === "both") ds.push(new FormDiscoverer());
  if (which === "network" || which === "both") ds.push(new NetworkDiscoverer());
  return ds;
}

export async function runWeb2Mcp(opts: Web2McpRunOpts): Promise<Web2McpResult> {
  const discoverers = opts.discoverers ?? buildDiscoverers(opts.discover ?? "both");
  const dopts: DiscoverOpts = {
    storageStatePath: opts.storageStatePath,
    maxActions: opts.maxActions,
    pageProvider: opts.pageProvider,
  };
  const all: ActionSpec[] = [];
  for (const d of discoverers) all.push(...(await d.discover(opts.url, dopts)));

  // 跨 discoverer 去重：同 (method, url) 视为同一动作（form 与 network 可能撞同一端点）。
  const seen = new Set<string>();
  const deduped: ActionSpec[] = [];
  for (const s of all) {
    const key = `${s.target.method.toUpperCase()} ${s.target.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(s);
  }

  // 两层验证的确定性硬门之一：发现不到任何动作即失败（别生成空壳 MCP）。
  if (deduped.length === 0) {
    throw new Error("未发现可执行动作（form/network 均无）——确认 URL 可达、已登录(--auth)、或页面确有表单/接口");
  }
  return emitMcpServer(deduped, opts.outDir);
}
