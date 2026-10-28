// site-capture · 一波官网公告采集：读 config → 逐 target 抓列表页 → 抽公告 → 去重 → 落知识库 → 写 seen/report。
// 结构与 wechat-capture/runwave.ts 同构，下游（digest）只依赖 capture 的 title/raw/tags。
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { isRecord } from "../../../util/is-record.js";
import {
  CaptureStore,
  newCapture,
  resolveCapturesDir,
  type Capture,
} from "../../../knowledge/capture-store.js";
import type { WaveResult } from "../../recipe.js";
import type { LoopDef } from "../../types.js";
import {
  dedupNewNotices,
  extractNotices,
  summarizeSiteWave,
  type SiteCaptureTarget,
  type SiteCaptureWaveResult,
  type SiteNotice,
} from "./core.js";
import { errorMessage } from "../../../util/errors.js";

const execFileAsync = promisify(execFile);

export interface SiteCaptureRunConfig {
  targets: SiteCaptureTarget[];
  /** 全波新增上限（默认 20）。 */
  maxNoticesPerWave: number;
  /** 单机构新增上限（默认 10）。 */
  maxPerTarget: number;
  userAgent: string;
}

export interface SiteCaptureRunWaveDeps {
  repoPath?: string;
  fetchText?: (url: string) => Promise<string>;
  appendCapture?: (capture: Capture) => Promise<boolean>;
  now?: number | (() => number);
  id?: () => string;
}

const DEFAULT_MAX_PER_WAVE = 20;
const DEFAULT_MAX_PER_TARGET = 10;
const DEFAULT_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36";
const CURL_TIMEOUT_SECONDS = "25";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function configDir(repoPath: string): string {
  return join(repoPath, ".kunpeng", "site-capture");
}

function isTarget(value: unknown): value is SiteCaptureTarget {
  return isRecord(value)
    && typeof value.name === "string" && value.name.trim() !== ""
    && typeof value.listUrl === "string" && /^https?:\/\//.test(value.listUrl);
}

export function readSiteCaptureConfig(repoPath: string): SiteCaptureRunConfig {
  const configPath = join(configDir(repoPath), "config.json");
  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code === "ENOENT") throw new Error(`site-capture 配置缺失: ${configPath}`, { cause: error });
    throw new Error(`site-capture 配置读取失败: ${configPath}`, { cause: error });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`site-capture 配置 JSON 解析失败: ${configPath}`, { cause: error });
  }
  if (!isRecord(raw) || !Array.isArray(raw.targets) || raw.targets.length === 0 || !raw.targets.every(isTarget)) {
    throw new Error(`site-capture 配置格式错误: ${configPath}`);
  }
  return {
    targets: raw.targets,
    maxNoticesPerWave: isFiniteNumber(raw.maxNoticesPerWave) ? Math.max(0, Math.floor(raw.maxNoticesPerWave)) : DEFAULT_MAX_PER_WAVE,
    maxPerTarget: isFiniteNumber(raw.maxPerTarget) ? Math.max(0, Math.floor(raw.maxPerTarget)) : DEFAULT_MAX_PER_TARGET,
    userAgent: typeof raw.userAgent === "string" && raw.userAgent.trim() !== "" ? raw.userAgent : DEFAULT_UA,
  };
}

export function readSeenIds(repoPath: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(configDir(repoPath), "seen.json"), "utf8"));
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) return new Set();
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

export function writeSeenIds(repoPath: string, ids: Iterable<string>): void {
  mkdirSync(configDir(repoPath), { recursive: true });
  writeFileSync(join(configDir(repoPath), "seen.json"), `${JSON.stringify([...new Set(ids)], null, 2)}\n`, "utf8");
}

/** 默认抓取走 curl -4：gov.cn 系站点对 IPv6 与 node fetch 不稳定，curl 是实测唯一稳定通道。 */
export function makeCurlFetchText(userAgent: string): (url: string) => Promise<string> {
  return async (url) => {
    const { stdout } = await execFileAsync(
      "curl",
      ["-4", "-sSL", "--compressed", "-m", CURL_TIMEOUT_SECONDS, "-A", userAgent, url],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    return stdout;
  };
}

function asDeps(deps: unknown): SiteCaptureRunWaveDeps {
  return typeof deps === "object" && deps !== null && !Array.isArray(deps) ? deps as SiteCaptureRunWaveDeps : {};
}

function resolveNow(now: SiteCaptureRunWaveDeps["now"]): () => number {
  if (typeof now === "number") return () => now;
  return now ?? Date.now;
}

function makeDefaultId(now: () => number): () => string {
  let counter = 0;
  return () => `sn-${now().toString(36)}-${counter++}`;
}

interface WaveState {
  fetchText: (url: string) => Promise<string>;
  appendCapture: (capture: Capture) => Promise<boolean>;
  now: () => number;
  id: () => string;
  seen: Set<string>;
  newlyCaptured: number;
}

async function processTarget(
  config: SiteCaptureRunConfig,
  target: SiteCaptureTarget,
  loop: LoopDef,
  state: WaveState,
): Promise<SiteCaptureWaveResult> {
  const html = await state.fetchText(target.listUrl);
  const notices = extractNotices(html, target);
  const remaining = Math.min(config.maxPerTarget, config.maxNoticesPerWave - state.newlyCaptured);
  const fresh = remaining > 0 ? dedupNewNotices(notices, state.seen).slice(0, remaining) : [];
  const captured: SiteNotice[] = [];
  for (const notice of fresh) {
    const capture = newCapture(
      {
        source: "url",
        kind: "site-notice",
        raw: notice.url,
        title: notice.title,
        summary: notice.date ? `发布日期 ${notice.date} · ${target.name}` : target.name,
        tags: ["site", target.name],
        citedFrom: notice.url,
        projectId: loop.projectId,
      },
      { now: state.now, id: state.id },
    );
    if (await state.appendCapture(capture)) {
      state.newlyCaptured += 1;
      captured.push(notice);
    }
    state.seen.add(notice.id);
  }
  return { target, fetched: notices.length, captured };
}

function writeReport(repoPath: string, nowMs: number, results: SiteCaptureWaveResult[], summary: unknown): void {
  mkdirSync(configDir(repoPath), { recursive: true });
  writeFileSync(join(configDir(repoPath), `report-${nowMs}.json`), `${JSON.stringify({ results, summary }, null, 2)}\n`, "utf8");
}

export async function runSiteCaptureWave(
  loop: LoopDef,
  _lever: string,
  _target: string | undefined,
  deps?: unknown,
): Promise<WaveResult> {
  const d = asDeps(deps);
  const repoPath = d.repoPath?.trim() || process.cwd();
  const metricBefore = loop.metric.current;
  const now = resolveNow(d.now);
  const nowMs = now();

  let config: SiteCaptureRunConfig;
  try {
    config = readSiteCaptureConfig(repoPath);
  } catch (error) {
    return { metricBefore, metricAfter: metricBefore, metricDelta: 0, verified: false, detail: errorMessage(error) };
  }

  const store = new CaptureStore(resolveCapturesDir(repoPath));
  const state: WaveState = {
    fetchText: d.fetchText ?? makeCurlFetchText(config.userAgent),
    appendCapture: d.appendCapture ?? store.appendCapture.bind(store),
    now,
    id: d.id ?? makeDefaultId(now),
    seen: readSeenIds(repoPath),
    newlyCaptured: 0,
  };

  const results: SiteCaptureWaveResult[] = [];
  for (const target of config.targets) {
    try {
      results.push(await processTarget(config, target, loop, state));
    } catch (error) {
      results.push({ target, fetched: 0, captured: [], error: errorMessage(error) });
    }
  }

  try {
    writeSeenIds(repoPath, state.seen);
  } catch {
    // seen 持久化失败不能让本波抓取结果作废。
  }
  const summary = summarizeSiteWave(results);
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