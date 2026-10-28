import { expect, test, vi } from "vitest";
import { fetchArticleViaXcrawl } from "../../src/knowledge/xcrawl-fetch.js";

function jsonResponse(payload: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => payload,
  } as Response;
}

test("fetchArticleViaXcrawl returns markdown from xcrawl JSON wrapper and sends required arguments", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () =>
    jsonResponse({
      result: {
        content: [
          {
            text: JSON.stringify({
              scrape_id: "x",
              data: { markdown: "# 标题\n正文内容" },
            }),
          },
        ],
      },
    }),
  );

  const result = await fetchArticleViaXcrawl("https://m.toutiao.com/is/abc/", {
    mcpUrl: "http://mcp",
    fetchImpl,
  });

  expect(result).toBe("# 标题\n正文内容");
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://mcp");
  const init = fetchImpl.mock.calls[0]?.[1];
  expect(init?.method).toBe("POST");
  expect(init?.headers).toEqual({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  });
  expect(typeof init?.body).toBe("string");
  const body = JSON.parse(String(init?.body)) as {
    method?: unknown;
    params?: {
      name?: unknown;
      arguments?: {
        url?: unknown;
        request?: { device?: unknown; only_main_content?: unknown };
        proxy?: { location?: unknown };
        output?: { formats?: unknown[] };
      };
    };
  };
  expect(body.method).toBe("tools/call");
  expect(body.params?.name).toBe("xcrawl_scrape");
  expect(body.params?.arguments?.url).toBe("https://m.toutiao.com/is/abc/");
  expect(body.params?.arguments?.request?.device).toBe("mobile");
  expect(body.params?.arguments?.request?.only_main_content).toBe(true);
  expect(body.params?.arguments?.proxy?.location).toBe("HK");
  expect(body.params?.arguments?.output?.formats).toContain("markdown");
});

test("fetchArticleViaXcrawl rejects HTTP errors", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}, { ok: false, status: 500 }));

  await expect(fetchArticleViaXcrawl("https://m.toutiao.com/is/abc/", { mcpUrl: "http://mcp", fetchImpl }))
    .rejects.toThrow(/xcrawl HTTP 500/);
});

test("fetchArticleViaXcrawl rejects JSON-RPC errors", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ error: { code: -1 } }));

  await expect(fetchArticleViaXcrawl("https://m.toutiao.com/is/abc/", { mcpUrl: "http://mcp", fetchImpl }))
    .rejects.toThrow(/xcrawl error/);
});

test("fetchArticleViaXcrawl rejects missing content text", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ result: {} }));

  await expect(fetchArticleViaXcrawl("https://m.toutiao.com/is/abc/", { mcpUrl: "http://mcp", fetchImpl }))
    .rejects.toThrow(/缺 content/);
});

test("fetchArticleViaXcrawl returns raw text when content text is not JSON", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () =>
    jsonResponse({ result: { content: [{ text: "纯文本无json" }] } }),
  );

  await expect(fetchArticleViaXcrawl("https://m.toutiao.com/is/abc/", { mcpUrl: "http://mcp", fetchImpl }))
    .resolves.toBe("纯文本无json");
});
