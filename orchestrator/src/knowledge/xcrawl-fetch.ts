export interface XcrawlFetchDeps {
  mcpUrl: string;
  fetchImpl?: typeof fetch;
}

interface XcrawlRpcPayload {
  result?: unknown;
  error?: unknown;
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

export function extractXcrawlMarkdown(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // xcrawl may return raw text instead of a JSON wrapper.
  }

  if (typeof parsed !== "object" || parsed === null) {
    if (text.trim().length > 0) return text;
    throw new Error("xcrawl 响应为空");
  }

  const data = (parsed as { data?: { markdown?: unknown } }).data;
  const md = data?.markdown;
  if (typeof md === "string" && md.length > 0) return md;

  const status = (parsed as { status?: unknown }).status;
  throw new Error(`xcrawl 未返回正文(status=${typeof status === "string" ? status : "无"})`);
}

export async function fetchArticleViaXcrawl(url: string, deps: XcrawlFetchDeps): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "xcrawl_scrape",
      arguments: {
        url,
        output: { formats: ["markdown"] },
        proxy: { location: "HK" },
        request: { only_main_content: true, device: "mobile" },
      },
    },
  };

  const response = await fetchImpl(deps.mcpUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error(`xcrawl HTTP ${response.status}`);

  const payload = (await response.json()) as XcrawlRpcPayload;
  if (payload.error !== undefined) throw new Error(`xcrawl error: ${JSON.stringify(payload.error)}`);

  const text = readContentText(payload.result);
  if (text === undefined) throw new Error("xcrawl 响应缺 content[0].text");

  return extractXcrawlMarkdown(text);
}
