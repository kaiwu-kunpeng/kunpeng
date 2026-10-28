import { isRecord } from "../../../util/is-record.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  CaptureStore,
  newCapture,
  resolveCapturesDir,
  type Capture,
} from "../../../knowledge/capture-store.js";
import type { WaveResult } from "../../recipe.js";
import type { LoopDef } from "../../types.js";
import {
  articleToCapturePayload,
  buildAccountSearchUrl,
  dedupNewArticles,
  parseAccountSearchResponse,
  parseGeneralMsgList,
  readWechatApiError,
  summarizeCaptureWave,
  type WechatArticle,
  type WechatCaptureConfig,
  type WechatCaptureTarget,
  type WechatCaptureWaveResult,
} from "./core.js";
import { errorMessage } from "../../../util/errors.js";

export interface WechatCaptureRunConfig extends WechatCaptureConfig {
  articleListPath: string;
  authKey?: string;
  maxArticlesPerWave?: number;
}

export interface WechatCaptureRunWaveDeps {
  repoPath?: string;
  fetchText?: (url: string, headers?: Record<string, string>) => Promise<string>;
  appendCapture?: (capture: Capture) => Promise<boolean>;
  now?: number | (() => number);
  id?: () => string;
}

const DEFAULT_PAGE_SIZE = 5;
const DEFAULT_MAX_ARTICLES_PER_WAVE = 20;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readConfigJson(repoPath: string): unknown {
  const configPath = join(repoPath, ".kunpeng", "wechat-capture", "config.json");
  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code === "ENOENT") throw new Error(`wechat-capture 配置缺失: ${configPath}`, { cause: error });
    throw new Error(`wechat-capture 配置读取失败: ${configPath}`, { cause: error });
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`wechat-capture 配置 JSON 解析失败: ${configPath}`, { cause: error });
  }
}

export function readWechatCaptureConfig(repoPath: string): WechatCaptureRunConfig {
  const raw = readConfigJson(repoPath);
  const configPath = join(repoPath, ".kunpeng", "wechat-capture", "config.json");
  if (!isRecord(raw)) throw new Error(`wechat-capture 配置格式错误: ${configPath}`);

  const exporterBaseUrl = raw.exporterBaseUrl;
  const targets = raw.targets;
  const articleListPath = raw.articleListPath;
  if (
    typeof exporterBaseUrl !== "string"
    || exporterBaseUrl.trim() === ""
    || !Array.isArray(targets)
    || typeof articleListPath !== "string"
    || articleListPath.trim() === ""
  ) {
    throw new Error(`wechat-capture 配置格式错误: ${configPath}`);
  }

  return {
    ...(raw as Omit<WechatCaptureRunConfig, "exporterBaseUrl" | "targets" | "articleListPath">),
    exporterBaseUrl,
    targets: targets as WechatCaptureTarget[],
    articleListPath,
    pageSize: isFiniteNumber(raw.pageSize) ? raw.pageSize : DEFAULT_PAGE_SIZE,
    maxArticlesPerWave: isFiniteNumber(raw.maxArticlesPerWave)
      ? raw.maxArticlesPerWave
      : DEFAULT_MAX_ARTICLES_PER_WAVE,
  };
}

export function buildArticleListUrl(
  config: Pick<WechatCaptureRunConfig, "exporterBaseUrl" | "articleListPath">,
  fakeid: string,
  begin: number,
): string {
  const base = config.exporterBaseUrl.replace(/\/+$/, "");
  const replaced = config.articleListPath
    .replaceAll("{fakeid}", encodeURIComponent(fakeid))
    .replaceAll("{begin}", String(begin));
  const path = replaced.startsWith("/") ? replaced : `/${replaced}`;
  return `${base}${path}`;
}

export function readSeenIds(repoPath: string): Set<string> {
  try {
    const text = readFileSync(join(repoPath, ".kunpeng", "wechat-capture", "seen.json"), "utf8");
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
      return new Set();
    }
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

export function writeSeenIds(repoPath: string, ids: Iterable<string>): void {
  const dir = join(repoPath, ".kunpeng", "wechat-capture");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "seen.json"), `${JSON.stringify([...new Set(ids)], null, 2)}\n`, "utf8");
}

function asDeps(deps: unknown): WechatCaptureRunWaveDeps {
  return typeof deps === "object" && deps !== null && !Array.isArray(deps)
    ? deps as WechatCaptureRunWaveDeps
    : {};
}

function resolveRepoPath(repoPath: string | undefined): string {
  const trimmed = repoPath?.trim();
  return trimmed && trimmed !== "" ? trimmed : process.cwd();
}

function resolveNow(now: WechatCaptureRunWaveDeps["now"]): () => number {
  if (typeof now === "number") return () => now;
  return now ?? Date.now;
}

function defaultFetchText(url: string, headers?: Record<string, string>): Promise<string> {
  return fetch(url, { headers }).then((response) => response.text());
}

function makeDefaultId(now: () => number): () => string {
  let counter = 0;
  return () => `wc-${now().toString(36)}-${counter++}`;
}

function maxArticles(value: number | undefined): number {
  if (!isFiniteNumber(value)) return DEFAULT_MAX_ARTICLES_PER_WAVE;
  return Math.max(0, Math.floor(value));
}

function headersForArticleList(config: WechatCaptureRunConfig): Record<string, string> | undefined {
  return config.authKey ? { "X-Auth-Key": config.authKey } : undefined;
}

async function resolveFakeid(
  config: WechatCaptureRunConfig,
  target: WechatCaptureTarget,
  fetchText: NonNullable<WechatCaptureRunWaveDeps["fetchText"]>,
): Promise<string | undefined> {
  if (target.fakeid && target.fakeid.trim() !== "") return target.fakeid;
  if (!target.keyword || target.keyword.trim() === "") return undefined;

  const searchText = await fetchText(buildAccountSearchUrl(config, target.keyword));
  return parseAccountSearchResponse(searchText)[0]?.fakeid;
}

function parseArticleListResponse(text: string): WechatArticle[] {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) return [];
  const generalMsgList = parsed.general_msg_list;
  if (typeof generalMsgList === "string") return parseGeneralMsgList(generalMsgList);
  if (generalMsgList === undefined) return parseGeneralMsgList(text);
  return parseGeneralMsgList(JSON.stringify(generalMsgList));
}

async function processTarget(
  config: WechatCaptureRunConfig,
  target: WechatCaptureTarget,
  loop: LoopDef,
  state: {
    fetchText: NonNullable<WechatCaptureRunWaveDeps["fetchText"]>;
    appendCapture: NonNullable<WechatCaptureRunWaveDeps["appendCapture"]>;
    now: () => number;
    id: () => string;
    seen: Set<string>;
    newlyCaptured: number;
  },
): Promise<{ result: WechatCaptureWaveResult; newlyCaptured: number }> {
  const fakeid = await resolveFakeid(config, target, state.fetchText);
  if (!fakeid) {
    return {
      result: { target, fetched: 0, captured: [], error: "未找到公众号" },
      newlyCaptured: state.newlyCaptured,
    };
  }

  const text = await state.fetchText(buildArticleListUrl(config, fakeid, 0), headersForArticleList(config));
  const apiError = readWechatApiError(text);
  if (apiError !== undefined) {
    return {
      result: { target, fetched: 0, captured: [], error: apiError },
      newlyCaptured: state.newlyCaptured,
    };
  }
  const articles = parseArticleListResponse(text);
  const remaining = maxArticles(config.maxArticlesPerWave) - state.newlyCaptured;
  const fresh = remaining > 0 ? dedupNewArticles(articles, state.seen).slice(0, remaining) : [];
  const captured: WechatArticle[] = [];
  let newlyCaptured = state.newlyCaptured;

  for (const article of fresh) {
    const payload = articleToCapturePayload(article, target);
    const capture = newCapture(
      {
        source: "url",
        kind: "wechat-article",
        raw: payload.url,
        title: payload.title,
        tags: payload.tags,
        citedFrom: payload.url,
        projectId: loop.projectId,
      },
      { now: state.now, id: state.id },
    );
    if (await state.appendCapture(capture)) {
      newlyCaptured += 1;
      captured.push(article);
    }
    state.seen.add(article.id);
  }

  return {
    result: { target, fetched: articles.length, captured },
    newlyCaptured,
  };
}

function writeReport(repoPath: string, nowMs: number, results: WechatCaptureWaveResult[], summary: unknown): void {
  const dir = join(repoPath, ".kunpeng", "wechat-capture");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `report-${nowMs}.json`), `${JSON.stringify({ results, summary }, null, 2)}\n`, "utf8");
}

export async function runWechatCaptureWave(
  loop: LoopDef,
  _lever: string,
  _target: string | undefined,
  deps?: unknown,
): Promise<WaveResult> {
  const d = asDeps(deps);
  const repoPath = resolveRepoPath(d.repoPath);
  const metricBefore = loop.metric.current;
  const now = resolveNow(d.now);
  const nowMs = now();

  let config: WechatCaptureRunConfig;
  try {
    config = readWechatCaptureConfig(repoPath);
  } catch (error) {
    return {
      metricBefore,
      metricAfter: metricBefore,
      metricDelta: 0,
      verified: false,
      detail: errorMessage(error),
    };
  }

  const store = new CaptureStore(resolveCapturesDir(repoPath));
  const state = {
    fetchText: d.fetchText ?? defaultFetchText,
    appendCapture: d.appendCapture ?? store.appendCapture.bind(store),
    now,
    id: d.id ?? makeDefaultId(now),
    seen: readSeenIds(repoPath),
    newlyCaptured: 0,
  };

  const results: WechatCaptureWaveResult[] = [];
  for (const target of config.targets) {
    try {
      const out = await processTarget(config, target, loop, state);
      state.newlyCaptured = out.newlyCaptured;
      results.push(out.result);
    } catch (error) {
      results.push({ target, fetched: 0, captured: [], error: errorMessage(error) });
    }
  }

  try {
    writeSeenIds(repoPath, state.seen);
  } catch {
    // seen 持久化失败不能让本波抓取结果作废。
  }

  const summary = summarizeCaptureWave(results);
  try {
    writeReport(repoPath, nowMs, results, summary);
  } catch {
    // 报告是旁路证据，失败不影响 WaveResult。
  }

  return {
    metricBefore,
    metricAfter: metricBefore + state.newlyCaptured,
    metricDelta: state.newlyCaptured,
    verified: summary.errors < summary.targets,
    detail: `新增 ${state.newlyCaptured}／抓取 ${summary.fetched}（错 ${summary.errors}/${summary.targets}）`,
    gotchas: summary.samples,
  };
}
