import { expect, test, vi } from "vitest";
import {
  decodeBingRedirect,
  extractXcrawlApiKey,
  parseXcrawlSearchPayload,
  searchViaXcrawl,
  type XcrawlSearchDeps,
} from "../../src/knowledge/xcrawl-search.js";

const MCP_URL = "https://mcp.xcrawl.com/xc-testkey123/mcp";
const SERP_URL = "https://run.xcrawl.com/v1/serp";

function jsonResponse(payload: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => payload,
  } as Response;
}

/** 把 xcrawl_search 的业务返回体包成 MCP 的 JSON-RPC 外壳。 */
function mcpEnvelope(inner: unknown): unknown {
  return { result: { content: [{ text: JSON.stringify(inner) }] } };
}

function serpPayload(rows: Array<{ title: string; link: string; snippet: string }>): unknown {
  return {
    organic_results: rows.map((row, index) => ({ ...row, position: index + 1 })),
    search_metadata: { status: "completed" },
    total_credits_used: 1,
  };
}

/** 按请求 URL 分流的 fetch 桩：MCP 一套返回，SERP 另一套。 */
function routedFetch(routes: { mcp?: unknown; serp?: unknown }) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === MCP_URL) return jsonResponse(routes.mcp ?? {});
    if (url === SERP_URL) return jsonResponse(routes.serp ?? {});
    throw new Error(`未预期的请求地址: ${url}`);
  });
}

function baseDeps(fetchImpl: typeof fetch, extra: Partial<XcrawlSearchDeps> = {}): XcrawlSearchDeps {
  return { mcpUrl: MCP_URL, fetchImpl, logger: () => {}, ...extra };
}

test("情况一：xcrawl_search 正常返回结果时直接采用，不走降级", async () => {
  const fetchImpl = routedFetch({
    mcp: mcpEnvelope({
      search_id: "01TEST",
      status: "completed",
      data: {
        status: "success",
        success_num: 2,
        credits_used: 2,
        data: [
          { position: 1, title: "标题一", url: "https://example.com/a", description: "摘要一" },
          { position: 2, title: "标题二", url: "https://example.com/b", description: "摘要二" },
        ],
      },
    }),
  });

  const results = await searchViaXcrawl("鲲鹏 智能体", baseDeps(fetchImpl, { preferMcpSearch: true }));

  expect(results).toEqual([
    { title: "标题一", url: "https://example.com/a", snippet: "摘要一" },
    { title: "标题二", url: "https://example.com/b", snippet: "摘要二" },
  ]);
  // 只打了 MCP 一次，没有触发 SERP 降级。
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(MCP_URL);

  const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
    method?: unknown;
    params?: { name?: unknown; arguments?: { query?: unknown } };
  };
  expect(body.method).toBe("tools/call");
  expect(body.params?.name).toBe("xcrawl_search");
  expect(body.params?.arguments?.query).toBe("鲲鹏 智能体");
});

test("情况二：success_num=0 的空结果触发降级到 SERP，并记录原因", async () => {
  const fetchImpl = routedFetch({
    mcp: mcpEnvelope({
      search_id: "01TEST",
      status: "completed",
      query: "pet friendly hotel",
      data: { status: "success", success_num: 0, data: [], credits_used: 2 },
    }),
    serp: serpPayload([
      { title: "降级标题", link: "https://fallback.example/x", snippet: "降级摘要" },
    ]),
  });
  const logs: string[] = [];

  const results = await searchViaXcrawl(
    "pet friendly hotel",
    baseDeps(fetchImpl, { preferMcpSearch: true, logger: (m) => logs.push(m) }),
  );

  expect(results).toEqual([
    { title: "降级标题", url: "https://fallback.example/x", snippet: "降级摘要" },
  ]);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(SERP_URL);
  expect(logs.join("\n")).toMatch(/返回 0 条结果.*降级/);

  // 降级请求必须带 Bearer 鉴权和 engine 字段。
  const init = fetchImpl.mock.calls[1]?.[1];
  expect(init?.headers).toMatchObject({ authorization: "Bearer xc-testkey123" });
  const serpBody = JSON.parse(String(init?.body)) as { engine?: unknown; q?: unknown };
  expect(serpBody.engine).toBe("duckduckgo_search");
  expect(serpBody.q).toBe("pet friendly hotel");
});

test("情况三：status=failed 触发降级到 SERP，并记录 failed 原因", async () => {
  const fetchImpl = routedFetch({
    mcp: mcpEnvelope({
      search_id: "01M0VG1A4DVKCEG8AD7HF4RHV2",
      endpoint: "search",
      status: "failed",
      query: "Genshin Impact",
      data: null,
      total_credits_used: 0,
    }),
    serp: serpPayload([
      { title: "维基条目", link: "https://en.wikipedia.org/wiki/Genshin_Impact", snippet: "开放世界游戏" },
    ]),
  });
  const logs: string[] = [];

  const results = await searchViaXcrawl(
    "Genshin Impact",
    baseDeps(fetchImpl, { preferMcpSearch: true, logger: (m) => logs.push(m) }),
  );

  expect(results).toEqual([
    { title: "维基条目", url: "https://en.wikipedia.org/wiki/Genshin_Impact", snippet: "开放世界游戏" },
  ]);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(logs.join("\n")).toMatch(/status=failed/);
});

test("默认不试已知故障的 xcrawl_search，直接走 SERP", async () => {
  const fetchImpl = routedFetch({
    serp: serpPayload([{ title: "直连", link: "https://direct.example/1", snippet: "摘要" }]),
  });

  const results = await searchViaXcrawl("鲲鹏", baseDeps(fetchImpl));

  expect(results).toHaveLength(1);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(SERP_URL);
});

test("两条路都空时返回空数组而不抛错，并留下日志", async () => {
  const fetchImpl = routedFetch({
    mcp: mcpEnvelope({ status: "completed", data: { status: "success", success_num: 0, data: [] } }),
    serp: serpPayload([]),
  });
  const logs: string[] = [];

  const results = await searchViaXcrawl(
    "无结果词",
    baseDeps(fetchImpl, { preferMcpSearch: true, logger: (m) => logs.push(m) }),
  );

  expect(results).toEqual([]);
  expect(logs.join("\n")).toMatch(/SERP.*也返回 0 条结果/);
});

test("bing_search 的跳转链接会被解包成真实地址", async () => {
  const real = "https://en.wikipedia.org/wiki/Genshin_Impact";
  const encoded = Buffer.from(real, "utf8").toString("base64url");
  const wrapped = `https://www.bing.com/ck/a?!&&p=abc&ptn=3&u=a1${encoded}&ntb=1`;

  expect(decodeBingRedirect(wrapped)).toBe(real);
  // 非 bing 跳转链接原样返回。
  expect(decodeBingRedirect(real)).toBe(real);

  const fetchImpl = routedFetch({
    serp: serpPayload([{ title: "维基", link: wrapped, snippet: "摘要" }]),
  });
  const results = await searchViaXcrawl("Genshin", baseDeps(fetchImpl, { engine: "bing_search" }));
  expect(results[0]?.url).toBe(real);
});

test("limit 会对结果做客户端截断", async () => {
  const fetchImpl = routedFetch({
    serp: serpPayload(
      Array.from({ length: 8 }, (_, i) => ({
        title: `t${i}`,
        link: `https://example.com/${i}`,
        snippet: `s${i}`,
      })),
    ),
  });

  const results = await searchViaXcrawl("多结果", baseDeps(fetchImpl, { limit: 3 }));
  expect(results).toHaveLength(3);
  expect(results[2]?.url).toBe("https://example.com/2");
});

test("SERP 返回 HTTP 错误时抛出中文错误", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}, { ok: false, status: 502 }));

  await expect(searchViaXcrawl("x", baseDeps(fetchImpl))).rejects.toThrow(/xcrawl SERP HTTP 502/);
});

test("mcpUrl 里没有 key 且未显式传 apiKey 时报错", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}));

  await expect(
    searchViaXcrawl("x", { mcpUrl: "https://mcp.xcrawl.com/mcp", fetchImpl, logger: () => {} }),
  ).rejects.toThrow(/拿不到 xcrawl API key/);
});

test("空搜索词直接报错", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}));
  await expect(searchViaXcrawl("   ", baseDeps(fetchImpl))).rejects.toThrow(/搜索词不能为空/);
  expect(fetchImpl).not.toHaveBeenCalled();
});

test("extractXcrawlApiKey 从 MCP url 解析 key", () => {
  expect(extractXcrawlApiKey(MCP_URL)).toBe("xc-testkey123");
  expect(extractXcrawlApiKey("https://mcp.xcrawl.com/mcp")).toBeUndefined();
});

test("parseXcrawlSearchPayload 对 failed / 空结果的处理", () => {
  expect(() => parseXcrawlSearchPayload(JSON.stringify({ status: "failed", data: null }))).toThrow(
    /status=failed/,
  );
  expect(parseXcrawlSearchPayload(JSON.stringify({ status: "completed", data: { data: [] } }))).toEqual([]);
  expect(() => parseXcrawlSearchPayload("不是 json")).toThrow(/不是合法 JSON/);
});
