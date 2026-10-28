// xcrawl 搜索封装：传 query，返回 [{title,url,snippet}]。
//
// 背景（2026-08-24 诊断结论）：
// xcrawl 的 `xcrawl_search` 工具（等价于 REST `POST /v1/search`）被写死走 Google，
// 而 Google 当前对 xcrawl 的抓取端返回「需要开启 JS」的机器人拦截页，
// 导致后端解析不到任何 organic 结果 → 任务卡满 60 秒后被判 `status:"failed"`（扣 0 credits），
// 或偶发返回 `status:"completed"` 但 `data.success_num = 0`（扣 2 credits）。
// 这不是调用姿势问题：厂商文档里的示例请求，经 MCP 和 REST 两条路复现，结果完全一致。
//
// 可用的替代路径是同账号下的兄弟接口 `POST /v1/serp`，它可以显式指定搜索引擎。
// 换成 `duckduckgo_search` / `bing_search` 后能在约 10 秒内拿到真实结果，且只扣 1 credit。
// 因此本模块的降级目标仍在 xcrawl 体内，不需要去裸爬第三方搜索页。

const DEFAULT_SERP_URL = "https://run.xcrawl.com/v1/serp";
const DEFAULT_ENGINE = "duckduckgo_search";
const DEFAULT_LIMIT = 10;
const DEFAULT_MCP_TIMEOUT_MS = 8000;

export interface XcrawlSearchDeps {
  /** xcrawl MCP 端点，形如 https://mcp.xcrawl.com/xc-<key>/mcp。API key 默认从这里解析。 */
  mcpUrl: string;
  fetchImpl?: typeof fetch;
  /** SERP REST 端点，默认 https://run.xcrawl.com/v1/serp。 */
  serpUrl?: string;
  /** 显式 API key；不传则从 mcpUrl 路径里取 xc- 开头的段。 */
  apiKey?: string;
  /** SERP 引擎，默认 duckduckgo_search（URL 干净、无需解包）。 */
  engine?: string;
  /** 结果条数上限，默认 10。DDG 不支持服务端限流，这里做客户端截断。 */
  limit?: number;
  /**
   * 是否先试 MCP 的 xcrawl_search。默认 false：该路径已被证实是厂商侧故障，
   * 白等一轮超时没有收益。等厂商修好 Google 抓取后可置 true 自动受益。
   */
  preferMcpSearch?: boolean;
  /** MCP 路径的超时（毫秒），避免被服务端的 60 秒挂起拖死。 */
  mcpTimeoutMs?: number;
  /** 降级原因日志。默认走 console.warn。 */
  logger?: (message: string) => void;
}

export interface XcrawlSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** 从 MCP url 里解析出 xc- 开头的 API key，解析不出返回 undefined。 */
export function extractXcrawlApiKey(mcpUrl: string): string | undefined {
  const match = /\/(xc-[A-Za-z0-9_-]+)(?:\/|$)/.exec(mcpUrl);
  return match?.[1];
}

/**
 * 解包 Bing 的 /ck/a 跳转链接。
 * 真实地址藏在查询参数 u 里，形如 u=a1<base64url>，需要去掉 a1 前缀再解码。
 * 不是 Bing 跳转链接、或解码失败时，原样返回。
 */
export function decodeBingRedirect(link: string): string {
  if (!link.includes("bing.com/ck/a")) return link;
  let encoded: string | null;
  try {
    encoded = new URL(link).searchParams.get("u");
  } catch {
    return link;
  }
  if (encoded === null) return link;
  const payload = encoded.startsWith("a1") ? encoded.slice(2) : encoded;
  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    return decoded.startsWith("http") ? decoded : link;
  } catch {
    return link;
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readContentText(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null || !("content" in result)) return undefined;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const first = content[0];
  if (typeof first !== "object" || first === null || !("text" in first)) return undefined;
  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : undefined;
}

/**
 * 解析 xcrawl_search / POST /v1/search 的返回体。
 * - 顶层 status 非 completed（典型是 failed）→ 抛错，交给上层降级。
 * - completed 但结果为空 → 返回 []，上层同样会降级。
 */
export function parseXcrawlSearchPayload(text: string): XcrawlSearchResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("xcrawl_search 返回体不是合法 JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("xcrawl_search 返回体不是对象");
  }

  const root = parsed as { status?: unknown; data?: unknown };
  const status = asString(root.status);
  if (status !== "completed") {
    throw new Error(`xcrawl_search 任务未完成(status=${status || "无"})`);
  }

  const data = root.data;
  if (typeof data !== "object" || data === null) return [];

  const inner = (data as { data?: unknown }).data;
  if (!Array.isArray(inner)) return [];

  return inner
    .map((item) => {
      if (typeof item !== "object" || item === null) return undefined;
      const row = item as { title?: unknown; url?: unknown; description?: unknown; snippet?: unknown };
      const url = asString(row.url);
      if (url === "") return undefined;
      return {
        title: asString(row.title),
        url,
        snippet: asString(row.description) || asString(row.snippet),
      };
    })
    .filter((item): item is XcrawlSearchResult => item !== undefined);
}

/** 解析 POST /v1/serp 的返回体，取 organic_results。 */
export function parseXcrawlSerpPayload(payload: unknown): XcrawlSearchResult[] {
  if (typeof payload !== "object" || payload === null) return [];
  const organic = (payload as { organic_results?: unknown }).organic_results;
  if (!Array.isArray(organic)) return [];

  return organic
    .map((item) => {
      if (typeof item !== "object" || item === null) return undefined;
      const row = item as { title?: unknown; link?: unknown; url?: unknown; snippet?: unknown; description?: unknown };
      const rawUrl = asString(row.link) || asString(row.url);
      if (rawUrl === "") return undefined;
      return {
        title: asString(row.title),
        url: decodeBingRedirect(rawUrl),
        snippet: asString(row.snippet) || asString(row.description),
      };
    })
    .filter((item): item is XcrawlSearchResult => item !== undefined);
}

async function searchViaMcp(
  query: string,
  deps: XcrawlSearchDeps,
  fetchImpl: typeof fetch,
): Promise<XcrawlSearchResult[]> {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "xcrawl_search",
      arguments: {
        query,
        location: "US",
        language: "en",
        limit: deps.limit ?? DEFAULT_LIMIT,
      },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.mcpTimeoutMs ?? DEFAULT_MCP_TIMEOUT_MS);
  try {
    const response = await fetchImpl(deps.mcpUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`xcrawl_search HTTP ${response.status}`);

    const payload = (await response.json()) as { result?: unknown; error?: unknown };
    if (payload.error !== undefined) {
      throw new Error(`xcrawl_search error: ${JSON.stringify(payload.error)}`);
    }

    const text = readContentText(payload.result);
    if (text === undefined) throw new Error("xcrawl_search 响应缺 content[0].text");

    return parseXcrawlSearchPayload(text);
  } finally {
    clearTimeout(timer);
  }
}

async function searchViaSerp(
  query: string,
  deps: XcrawlSearchDeps,
  fetchImpl: typeof fetch,
): Promise<XcrawlSearchResult[]> {
  const apiKey = deps.apiKey ?? extractXcrawlApiKey(deps.mcpUrl);
  if (apiKey === undefined || apiKey === "") {
    throw new Error("拿不到 xcrawl API key：mcpUrl 里没有 xc- 段，也没有显式传 apiKey");
  }

  const response = await fetchImpl(deps.serpUrl ?? DEFAULT_SERP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ engine: deps.engine ?? DEFAULT_ENGINE, q: query }),
  });

  if (!response.ok) throw new Error(`xcrawl SERP HTTP ${response.status}`);

  return parseXcrawlSerpPayload(await response.json());
}

/**
 * 搜索入口：先按需试 xcrawl_search，拿不到结果就降级到 /v1/serp 指定引擎。
 * 两条路都空则返回 []，不抛；只有降级路自身报错才抛。
 */
export async function searchViaXcrawl(
  query: string,
  deps: XcrawlSearchDeps,
): Promise<XcrawlSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed === "") throw new Error("搜索词不能为空");

  const fetchImpl = deps.fetchImpl ?? fetch;
  const limit = deps.limit ?? DEFAULT_LIMIT;
  const log = deps.logger ?? ((message: string) => console.warn(message));

  if (deps.preferMcpSearch === true) {
    try {
      const results = await searchViaMcp(trimmed, deps, fetchImpl);
      if (results.length > 0) return results.slice(0, limit);
      log(`[xcrawl-search] xcrawl_search 返回 0 条结果，降级到 SERP(${deps.engine ?? DEFAULT_ENGINE})`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log(`[xcrawl-search] xcrawl_search 失败(${reason})，降级到 SERP(${deps.engine ?? DEFAULT_ENGINE})`);
    }
  }

  const results = await searchViaSerp(trimmed, deps, fetchImpl);
  if (results.length === 0) {
    log(`[xcrawl-search] SERP(${deps.engine ?? DEFAULT_ENGINE}) 也返回 0 条结果`);
  }
  return results.slice(0, limit);
}
