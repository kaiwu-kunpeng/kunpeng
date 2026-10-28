import { isRecord } from "../util/is-record.js";
import { execFileSync } from "node:child_process";
import { open, readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { FailureItem } from "./failure-signature.js";
import { parseMergedRecordsFromGitLog } from "./flow-records.js";
import type { WeeklyFlow } from "./weekly-report.js";
import { flowsToCostReport } from "../runtime/flow-cost.js";

const FAILED_STATUSES = new Set(["failed", "rolled-back", "crashed", "stopped"]);
const LOG_TAIL_BYTES = 64 * 1024;
// 有意匹配并移除日志中的 ANSI 控制转义序列。
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /[\u001B\u009B](?:\][^\u0007]*(?:\u0007|\u001B\\)|\[[0-?]*[ -/]*[@-~]|[()][0-2A-Z]|[@-_])/g;

function finiteToken(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function weeklyTokens(flow: Record<string, unknown>): WeeklyFlow["tokens"] {
  const total = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
  const add = (record: Record<string, unknown>): void => {
    for (const key of ["input", "output", "cacheCreate", "cacheRead"] as const) {
      total[key] += finiteToken(record, key);
    }
  };

  if (isRecord(flow.tokenQuad)) {
    add(flow.tokenQuad);
    return total;
  }
  if (isRecord(flow.tokens)) {
    add(flow.tokens);
    return total;
  }
  if (isRecord(flow.stageUsage)) {
    const usages = Object.values(flow.stageUsage).filter(isRecord);
    if (usages.length > 0) {
      for (const usage of usages) add(usage);
      return total;
    }
  }
  if (isRecord(flow.usage)) {
    add(flow.usage);
    return total;
  }
  add(flow);
  return total;
}

function weeklyUsd(flow: Record<string, unknown>): number | undefined {
  if (typeof flow.usd === "number" && Number.isFinite(flow.usd)) return flow.usd;
  const report = flowsToCostReport([flow]);
  return report.totalTokens > 0 && Number.isFinite(report.cost.totalUsd) ? report.cost.totalUsd : undefined;
}

function repoRootFromStateDir(stateDir: string): string | undefined {
  const absolute = resolve(stateDir);
  const kunpengDir = dirname(absolute);
  if (basename(absolute) !== "state" || basename(kunpengDir) !== ".kunpeng") return undefined;
  return dirname(kunpengDir);
}

function mergedTimes(stateDir: string): Map<string, number | undefined> {
  const repoRoot = repoRootFromStateDir(stateDir);
  if (repoRoot === undefined) return new Map();

  let mergedLog: string;
  try {
    mergedLog = execFileSync("git", ["log", "--merges", "--format=%ct|%s", "--all"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 120_000,
    });
  } catch (error) {
    throw new Error(`无法读取 flow 合并记录 ${repoRoot}: ${(error as Error).message}`, { cause: error });
  }
  return new Map(parseMergedRecordsFromGitLog(mergedLog).map((record) => [record.flowId, record.mergedAt]));
}

export async function readWeeklyFlows(stateDir: string): Promise<WeeklyFlow[]> {
  let files: string[];
  try {
    files = (await readdir(stateDir)).filter((file) => file.endsWith(".json"));
  } catch (error) {
    throw new Error(`无法读取 flow 状态目录 ${stateDir}: ${(error as Error).message}`, { cause: error });
  }

  const mergedAtById = mergedTimes(stateDir);
  const flows: WeeklyFlow[] = [];
  for (const file of files) {
    const path = join(stateDir, file);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    if (typeof parsed.flowId !== "string" || parsed.flowId.trim() === "") continue;
    if (typeof parsed.status !== "string" || parsed.status.trim() === "") {
      throw new Error(`flow 状态缺少 status ${path}`);
    }
    const mergedAt = parsed.status === "verified" ? mergedAtById.get(parsed.flowId) : undefined;
    const at = mergedAt ?? parsed.updatedAt;
    if (typeof at !== "number" || !Number.isFinite(at)) {
      throw new Error(`flow 状态缺少有效时间 ${path}`);
    }
    const usd = weeklyUsd(parsed);
    flows.push({
      id: parsed.flowId,
      status: parsed.status,
      at,
      tokens: weeklyTokens(parsed),
      ...(usd === undefined ? {} : { usd }),
      ...(mergedAt === undefined ? {} : { merged: true }),
    });
  }
  return flows;
}

async function readLogTail(logPath: string): Promise<string | undefined> {
  let handle;
  try {
    handle = await open(logPath, "r");
    const { size } = await handle.stat();
    const length = Math.min(size, LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, Math.max(0, size - length));
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function reasonFromLog(logPath: unknown): Promise<string | undefined> {
  if (typeof logPath !== "string" || logPath.trim() === "") return undefined;
  const tail = await readLogTail(logPath);
  if (tail === undefined) return undefined;

  const matches = [...tail.matchAll(/reason=([^\r\n]*)/g)];
  const raw = matches.at(-1)?.[1];
  if (raw === undefined) return undefined;
  const reason = raw.replace(ANSI_ESCAPE, "").trim().slice(0, 300);
  return reason === "" ? undefined : reason;
}

export async function readRecentFailureItems(
  stateDir: string,
  days: number,
  now: number,
): Promise<FailureItem[]> {
  let files: string[];
  try {
    files = (await readdir(stateDir)).filter((file) => file.endsWith(".json"));
  } catch (error) {
    throw new Error(`无法读取 flow 状态目录 ${stateDir}: ${(error as Error).message}`, { cause: error });
  }

  const cutoff = now - days * 86_400_000;
  const items: FailureItem[] = [];
  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(join(stateDir, file), "utf8")) as unknown;
    } catch {
      continue;
    }
    if (!isRecord(parsed) || !FAILED_STATUSES.has(String(parsed.status))) continue;
    if (typeof parsed.updatedAt !== "number" || !Number.isFinite(parsed.updatedAt) || parsed.updatedAt < cutoff) continue;
    if (typeof parsed.flowId !== "string" || parsed.flowId.trim() === "") continue;

    const topLevelReason = [parsed.failureReason, parsed.blocker, parsed.reason, parsed.error]
      .find((value): value is string => typeof value === "string" && value.trim() !== "");
    const reason = topLevelReason
      ?? await reasonFromLog(parsed.logPath)
      ?? `(阶段 ${String(parsed.stage ?? "?")} 失败,无原因记录)`;
    items.push({ id: parsed.flowId, reason, at: parsed.updatedAt });
  }
  return items;
}
