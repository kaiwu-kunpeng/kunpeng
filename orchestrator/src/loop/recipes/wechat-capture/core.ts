import { isRecord } from "../../../util/is-record.js";

export interface WechatCaptureTarget {
  fakeid?: string;
  nickname?: string;
  alias?: string;
  keyword?: string;
}

export interface WechatCaptureConfig {
  exporterBaseUrl: string;
  targets: WechatCaptureTarget[];
  pageSize?: number;
}

export interface WechatAccount {
  fakeid: string;
  nickname: string;
  alias: string;
}

export interface WechatArticle {
  id: string;
  title: string;
  url: string;
  author?: string;
  digest?: string;
  publishedAt?: number;
}

export interface CapturePayload {
  url: string;
  title: string;
  source: string;
  tags: string[];
  publishedAt?: number;
}

export interface WechatCaptureWaveResult {
  target: WechatCaptureTarget;
  fetched: number;
  captured: WechatArticle[];
  error?: string;
}

export function readWechatApiError(text: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed)) return undefined;
  const baseResp = parsed.base_resp;
  if (!isRecord(baseResp) || typeof baseResp.ret !== "number" || baseResp.ret === 0) {
    return undefined;
  }

  const suffix = typeof baseResp.err_msg === "string" ? ` ${baseResp.err_msg}` : "";
  return `接口返回 ret=${baseResp.ret}${suffix}`;
}

export function buildAccountSearchUrl(
  config: Pick<WechatCaptureConfig, "exporterBaseUrl" | "pageSize">,
  keyword: string,
  opts: { begin?: number; size?: number } = {},
): string {
  const base = config.exporterBaseUrl.replace(/\/+$/, "");
  const begin = opts.begin ?? 0;
  const size = opts.size ?? config.pageSize ?? 5;
  return `${base}/api/public/v1/account?keyword=${encodeURIComponent(keyword)}&begin=${begin}&size=${size}`;
}

export function parseAccountSearchResponse(text: string): WechatAccount[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  if (!isRecord(parsed)) return [];
  const baseResp = parsed.base_resp;
  if (!isRecord(baseResp) || baseResp.ret !== 0) return [];
  if (!Array.isArray(parsed.list)) return [];

  const accounts: WechatAccount[] = [];
  for (const item of parsed.list) {
    if (!isRecord(item)) continue;

    const fakeid = stringValue(item.fakeid);
    if (!fakeid) continue;

    accounts.push({
      fakeid,
      nickname: stringValue(item.nickname),
      alias: stringValue(item.alias),
    });
  }
  return accounts;
}

export function parseGeneralMsgList(raw: string): WechatArticle[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!isRecord(parsed)) return [];
  if (!Array.isArray(parsed.list)) {
    if (!Array.isArray(parsed.articles)) return [];

    const exporterArticles: WechatArticle[] = [];
    for (const item of parsed.articles) {
      const article = parseExporterArticle(item);
      if (article !== undefined) exporterArticles.push(article);
    }
    return exporterArticles;
  }

  const articles: WechatArticle[] = [];
  for (const batch of parsed.list) {
    if (!isRecord(batch)) continue;

    const publishedAt = readPublishedAt(batch.comm_msg_info);
    const main = batch.app_msg_ext_info;
    const mainArticle = parseMessageItem(main, publishedAt);
    if (mainArticle !== undefined) articles.push(mainArticle);

    if (!isRecord(main) || main.is_multi !== 1 || !Array.isArray(main.multi_app_msg_item_list)) continue;

    for (const item of main.multi_app_msg_item_list) {
      const article = parseMessageItem(item, publishedAt);
      if (article !== undefined) articles.push(article);
    }
  }

  return articles;
}

function parseExporterArticle(item: unknown): WechatArticle | undefined {
  try {
    if (!isRecord(item)) return undefined;
    if (item.is_deleted === true) return undefined;

    const rawUrl = stringValue(item.link).trim();
    if (!rawUrl) return undefined;

    const url = rawUrl.replace(/&amp;/g, "&");
    const article: WechatArticle = {
      id: articleIdFromUrl(url),
      title: stringValue(item.title),
      url,
    };

    const author = stringValue(item.author_name);
    if (author) article.author = author;

    const digest = stringValue(item.digest);
    if (digest) article.digest = digest;

    const publishedAt = item.create_time;
    if (typeof publishedAt === "number" && Number.isFinite(publishedAt) && publishedAt > 0) {
      article.publishedAt = publishedAt;
    }

    return article;
  } catch {
    return undefined;
  }
}

export function dedupNewArticles(articles: WechatArticle[], seenIds: Iterable<string>): WechatArticle[] {
  const seen = new Set(seenIds);
  const current = new Set<string>();
  const out: WechatArticle[] = [];

  for (const article of articles) {
    if (seen.has(article.id) || current.has(article.id)) continue;

    current.add(article.id);
    out.push(article);
  }

  return out;
}

export function articleToCapturePayload(article: WechatArticle, target: WechatCaptureTarget): CapturePayload {
  const source = target.nickname || target.keyword || "wechat";
  const tags = uniqueNonEmpty(["wechat", source]);
  const payload: CapturePayload = {
    url: article.url,
    title: article.title,
    source,
    tags,
  };

  if (article.publishedAt !== undefined) payload.publishedAt = article.publishedAt;

  return payload;
}

export function summarizeCaptureWave(results: WechatCaptureWaveResult[]): {
  targets: number;
  fetched: number;
  newCount: number;
  errors: number;
  samples: string[];
} {
  const samples: string[] = [];

  for (const result of results) {
    const source = result.target.nickname || result.target.keyword || "wechat";
    for (const article of result.captured) {
      if (samples.length >= 5) break;

      samples.push(`「${article.title.slice(0, 60)}」${source}`);
    }
  }

  return {
    targets: results.length,
    fetched: results.reduce((sum, result) => sum + result.fetched, 0),
    newCount: results.reduce((sum, result) => sum + result.captured.length, 0),
    errors: results.filter((result) => result.error !== undefined).length,
    samples,
  };
}

function parseMessageItem(item: unknown, publishedAt: number | undefined): WechatArticle | undefined {
  try {
    if (!isRecord(item)) return undefined;
    if (item.del_flag === 1) return undefined;

    const rawUrl = stringValue(item.content_url).trim();
    if (!rawUrl) return undefined;

    const url = rawUrl.replace(/&amp;/g, "&");
    const article: WechatArticle = {
      id: articleIdFromUrl(url),
      title: stringValue(item.title),
      url,
    };

    const author = optionalString(item.author);
    if (author !== undefined) article.author = author;

    const digest = optionalString(item.digest);
    if (digest !== undefined) article.digest = digest;

    if (publishedAt !== undefined) article.publishedAt = publishedAt;

    return article;
  } catch {
    return undefined;
  }
}

function articleIdFromUrl(url: string): string {
  try {
    const parsed = new URL(url, "https://mp.weixin.qq.com");
    const mid = parsed.searchParams.get("mid");
    const idx = parsed.searchParams.get("idx");
    if (mid && idx) return `${mid}_${idx}`;
  } catch {
    // Fall through to stable hash.
  }

  return djb2Hex(url);
}

function readPublishedAt(commMsgInfo: unknown): number | undefined {
  if (!isRecord(commMsgInfo)) return undefined;
  return typeof commMsgInfo.datetime === "number" ? commMsgInfo.datetime : undefined;
}

function djb2Hex(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    if (!value || seen.has(value)) continue;

    seen.add(value);
    out.push(value);
  }

  return out;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
