import { assertPublicHttpUrl } from "../util/ssrf-guard.js";

export interface RefScrape {
  rawHtml: string;
  markdown: string;
  metadata: Record<string, string>;
  links: string[];
  host: string;
}

export function parseMetaTags(html: string): Record<string, string> {
  const result: Record<string, string> = {};
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (titleMatch) {
    result.title = titleMatch[1].trim();
  }

  const metaTagPattern = /<meta\b[^>]*>/gi;
  for (const match of html.matchAll(metaTagPattern)) {
    const tag = match[0];
    const keyMatch = /(?:name|property)=["']([^"']+)["']/i.exec(tag);
    const valueMatch = /content=["']([^"']*)["']/i.exec(tag);
    if (keyMatch && valueMatch) {
      result[keyMatch[1]] = valueMatch[1];
    }
  }

  return result;
}

export function parseLinks(html: string, baseUrl: string): string[] {
  const links = new Set<string>();
  const hrefPattern = /href=["']([^"']+)["']/gi;

  for (const match of html.matchAll(hrefPattern)) {
    try {
      links.add(new URL(match[1], baseUrl).href);
    } catch {
      continue;
    }
  }

  return [...links];
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const REF_FETCH_TIMEOUT_MS = 15_000;
export const REF_MAX_BYTES = 2_000_000;
export const REF_MAX_REDIRECTS = 3;

export interface FetchRefTextDeps {
  fetch?: typeof fetch;
  lookup?: (host: string) => Promise<string[]>;
  timeoutMs?: number;
  maxBytes?: number;
}

/** 抓参考站 HTML：每一跳（含重定向）都先过 SSRF 闸（只放公网 http/https），带超时，响应体超上限即截断。 */
export async function fetchRefText(rawUrl: string, deps: FetchRefTextDeps = {}): Promise<string> {
  const doFetch = deps.fetch ?? fetch;
  const maxBytes = deps.maxBytes ?? REF_MAX_BYTES;
  const signal = AbortSignal.timeout(deps.timeoutMs ?? REF_FETCH_TIMEOUT_MS);
  let current = rawUrl;
  for (let hop = 0; hop <= REF_MAX_REDIRECTS; hop += 1) {
    await assertPublicHttpUrl(current, deps.lookup ? { lookup: deps.lookup } : {});
    const res = await doFetch(current, { redirect: "manual", signal });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`重定向缺少 Location（HTTP ${res.status}）`);
      current = new URL(location, current).href;
      continue;
    }
    if (!res.ok) throw new Error(`抓取失败 HTTP ${res.status}`);
    return await readCapped(res, maxBytes);
  }
  throw new Error(`重定向超过 ${REF_MAX_REDIRECTS} 次`);
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, maxBytes);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = maxBytes - total;
    const piece = value.byteLength > room ? value.subarray(0, room) : value;
    chunks.push(piece);
    total += piece.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchRefScrape(
  url: string,
  deps?: { fetchText?: (u: string) => Promise<string> },
): Promise<RefScrape> {
  const html = deps?.fetchText
    ? await deps.fetchText(url)
    : await fetchRefText(url);
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return "";
    }
  })();

  return {
    rawHtml: html,
    markdown: htmlToText(html).slice(0, 20000),
    metadata: parseMetaTags(html),
    links: parseLinks(html, url),
    host,
  };
}
