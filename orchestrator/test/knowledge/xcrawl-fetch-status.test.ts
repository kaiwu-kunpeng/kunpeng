import { expect, test, vi } from "vitest";
import { extractXcrawlMarkdown, fetchArticleViaXcrawl } from "../../src/knowledge/xcrawl-fetch.js";

function jsonResponse(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload } as Response;
}

test("extractXcrawlMarkdown: data.markdown 包装取正文", () => {
  expect(extractXcrawlMarkdown(JSON.stringify({ data: { markdown: "# 正文" } }))).toBe("# 正文");
});

test("extractXcrawlMarkdown: 非 JSON 纯文本原样返回", () => {
  expect(extractXcrawlMarkdown("![logo](x) 一段正文")).toBe("![logo](x) 一段正文");
});

test("extractXcrawlMarkdown: 失败票据(status=failed,无 markdown)抛错而非当正文", () => {
  const ticket = JSON.stringify({ scrape_id: "01ABC", endpoint: "scrape", status: "failed", url: "https://x" });
  expect(() => extractXcrawlMarkdown(ticket)).toThrow(/未返回正文/);
});

test("extractXcrawlMarkdown: 异步处理中票据(有 scrape_id 无 markdown)抛错", () => {
  expect(() => extractXcrawlMarkdown(JSON.stringify({ scrape_id: "01ABC", status: "processing" }))).toThrow(/未返回正文/);
});

test("fetchArticleViaXcrawl: 失败票据响应整体抛错(让上游降级 plain-fetch)", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () =>
    jsonResponse({ result: { content: [{ text: JSON.stringify({ scrape_id: "01ABC", status: "failed" }) }] } }),
  );
  await expect(fetchArticleViaXcrawl("https://m.toutiao.com/is/abc/", { mcpUrl: "http://mcp", fetchImpl }))
    .rejects.toThrow(/未返回正文/);
});
