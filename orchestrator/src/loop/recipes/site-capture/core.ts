// site-capture · 官网公告列表页解析（纯函数、零 I/O）。
// 目标：不为每个站写解析器——只靠"锚点 + 附近日期"的通用启发式抽出 标题/绝对URL/日期，
// 站点差异用 target 上的 titleInclude / urlInclude 过滤兜住。

export interface SiteCaptureTarget {
  /** 机构名，落库时作为 tags 末项与来源标注。 */
  name: string;
  /** 公告列表页 URL；相对链接以它为基准解析。 */
  listUrl: string;
  /** 标题正则过滤（如总栏目里只要"出入境"）。 */
  titleInclude?: string;
  /** URL 正则过滤（如只要 /policy/ 路径）。 */
  urlInclude?: string;
}

export interface SiteNotice {
  id: string;
  title: string;
  url: string;
  /** YYYY-MM-DD；列表页没写日期则缺省。 */
  date?: string;
}

export interface SiteCaptureWaveResult {
  target: SiteCaptureTarget;
  fetched: number;
  captured: SiteNotice[];
  error?: string;
}

const MIN_TITLE_LENGTH = 6;
const DEFAULT_LIMIT = 30;
const AFTER_WINDOW = 320;
const BEFORE_WINDOW = 260;

const DATE_FULL = /(20\d{2})\s*[-./年]\s*(\d{1,2})\s*[-./月]\s*(\d{1,2})/g;
/** 拆分写法：<span>MM-DD</span>YYYY。 */
const DATE_SPLIT = /(\d{1,2})\s*-\s*(\d{1,2})\s*<\/span>\s*(20\d{2})/g;

function pad2(n: string): string {
  return n.padStart(2, "0");
}

function validYmd(y: string, m: string, d: string): string | undefined {
  const mm = Number(m);
  const dd = Number(d);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return undefined;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** 把 2026-08-28 / 2026 / 08 / 27 / 2026.8.6 / 2026年9月1日 归一成 YYYY-MM-DD。 */
export function normalizeDate(text: string): string | undefined {
  for (const m of text.matchAll(DATE_FULL)) {
    const ymd = validYmd(m[1]!, m[2]!, m[3]!);
    if (ymd) return ymd;
  }
  return undefined;
}

function lastDate(text: string): string | undefined {
  let out: string | undefined;
  for (const m of text.matchAll(DATE_FULL)) {
    const ymd = validYmd(m[1]!, m[2]!, m[3]!);
    if (ymd) out = ymd;
  }
  if (out) return out;
  for (const m of text.matchAll(DATE_SPLIT)) {
    const ymd = validYmd(m[3]!, m[1]!, m[2]!);
    if (ymd) out = ymd;
  }
  return out;
}

function firstDate(text: string): string | undefined {
  const full = normalizeDate(text);
  if (full) return full;
  for (const m of text.matchAll(DATE_SPLIT)) {
    const ymd = validYmd(m[3]!, m[1]!, m[2]!);
    if (ymd) return ymd;
  }
  return undefined;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)));
}

function cleanHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function attrValue(attrs: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = attrs.match(re);
  if (!m) return undefined;
  return decodeEntities((m[1] ?? m[2] ?? m[3] ?? "").trim());
}

/** 锚点文本为空时：向后找第一段 ≥ MIN_TITLE_LENGTH 的文本节点（截止到下一个 <a）。 */
function lookaheadTitle(after: string): string | undefined {
  const upToNextAnchor = after.split(/<a\b/i)[0] ?? "";
  for (const chunk of upToNextAnchor.split(/<[^>]+>/)) {
    const text = decodeEntities(chunk).replace(/\s+/g, " ").trim();
    if (text.length >= MIN_TITLE_LENGTH && !isDateOnly(text)) return text;
  }
  return undefined;
}

function cutAtNextItem(after: string): string {
  const idx = after.search(/<a\b|<\/li\b/i);
  return idx >= 0 ? after.slice(0, idx) : after;
}

function cutAtPrevItem(before: string): string {
  const matches = [...before.matchAll(/<\/li\b[^>]*>|<\/a\b[^>]*>/gi)];
  const last = matches[matches.length - 1];
  return last && last.index !== undefined ? before.slice(last.index + last[0].length) : before;
}

/** 锚点内文：按标签切成文本节点，丢掉"整段只是日期"的节点（如 <div class=y>2026 / 08 / 27</div>），标题里自带的日期保留。 */
function innerTitle(inner: string): string {
  const parts: string[] = [];
  for (const chunk of inner.split(/<[^>]+>/)) {
    const text = decodeEntities(chunk).replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (isDateOnly(text)) continue;
    parts.push(text);
  }
  return parts.join(" ").trim();
}

/** 锚点内部"只含日期"的节点才算发布日期，标题里夹带的日期不算。 */
function innerDate(inner: string): string | undefined {
  for (const chunk of inner.split(/<[^>]+>/)) {
    const text = decodeEntities(chunk).replace(/\s+/g, " ").trim();
    if (text && isDateOnly(text)) return normalizeDate(text);
  }
  return undefined;
}

function isDateOnly(text: string): boolean {
  const stripped = text.replace(DATE_FULL, "").replace(/[\s日]/g, "");
  return stripped === "" && normalizeDate(text) !== undefined;
}

function resolveUrl(href: string, listUrl: string): string | undefined {
  if (/^\s*(javascript:|mailto:|tel:|#)/i.test(href)) return undefined;
  let base: URL;
  let url: URL;
  try {
    base = new URL(listUrl);
    url = new URL(href, base);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.hostname !== base.hostname) return undefined;
  url.hash = "";
  return url.toString();
}

/** djb2 十六进制，与 URL 一一对应，作为 seen 去重键。 */
export function noticeIdFromUrl(url: string): string {
  let hash = 5381;
  for (let i = 0; i < url.length; i += 1) {
    hash = ((hash << 5) + hash + url.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function safeRegExp(pattern: string | undefined): RegExp | undefined {
  if (!pattern) return undefined;
  try {
    return new RegExp(pattern);
  } catch {
    return undefined;
  }
}

export function extractNotices(
  html: string,
  target: SiteCaptureTarget,
  opts?: { limit?: number },
): SiteNotice[] {
  const cleaned = cleanHtml(html);
  const titleRe = safeRegExp(target.titleInclude);
  const urlRe = safeRegExp(target.urlInclude);
  const seenUrls = new Set<string>();
  const out: SiteNotice[] = [];
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

  for (const m of cleaned.matchAll(anchorRe)) {
    const attrs = m[1] ?? "";
    const inner = m[2] ?? "";
    const href = attrValue(attrs, "href");
    if (!href) continue;
    const url = resolveUrl(href, target.listUrl);
    if (!url || seenUrls.has(url)) continue;

    const start = m.index ?? 0;
    const end = start + m[0].length;
    // 日期只在"本条"范围内找：向后截止到下一个锚点或 </li>，向前截止到上一个 </li> 或 </a>，
    // 否则无日期的链接会借用邻条的日期冒充公告。
    const after = cutAtNextItem(cleaned.slice(end, end + AFTER_WINDOW));
    const before = cutAtPrevItem(cleaned.slice(Math.max(0, start - BEFORE_WINDOW), start));

    let title = innerTitle(inner);
    if (title.length < MIN_TITLE_LENGTH) title = attrValue(attrs, "title") ?? "";
    if (title.length < MIN_TITLE_LENGTH) title = lookaheadTitle(after) ?? "";
    if (title.length < MIN_TITLE_LENGTH) continue;

    if (titleRe && !titleRe.test(title)) continue;
    if (urlRe && !urlRe.test(url)) continue;

    const date = innerDate(inner) ?? firstDate(after) ?? lastDate(before);
    if (!date) continue;

    seenUrls.add(url);
    out.push({ id: noticeIdFromUrl(url), title, url, date });
  }

  const dated = out.filter((n) => n.date !== undefined);
  const undated = out.filter((n) => n.date === undefined);
  dated.sort((a, b) => (a.date! < b.date! ? 1 : a.date! > b.date! ? -1 : 0));
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  return [...dated, ...undated].slice(0, Math.max(0, limit));
}

export function dedupNewNotices(notices: SiteNotice[], seenIds: Iterable<string>): SiteNotice[] {
  const seen = new Set(seenIds);
  return notices.filter((n) => !seen.has(n.id));
}

export function summarizeSiteWave(results: SiteCaptureWaveResult[]): {
  targets: number;
  fetched: number;
  newCount: number;
  errors: number;
  samples: string[];
} {
  const samples: string[] = [];
  for (const result of results) {
    for (const notice of result.captured) {
      if (samples.length >= 5) break;
      samples.push(`「${notice.title.slice(0, 60)}」${result.target.name}`);
    }
  }
  return {
    targets: results.length,
    fetched: results.reduce((sum, r) => sum + r.fetched, 0),
    newCount: results.reduce((sum, r) => sum + r.captured.length, 0),
    errors: results.filter((r) => r.error !== undefined).length,
    samples,
  };
}