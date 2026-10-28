import { readFile } from "node:fs/promises";
import { hostname as systemHostname, homedir } from "node:os";
import { join } from "node:path";

import { createWorkerClient } from "../server/worker/worker-client.js";
import { registerCliCommand, type CliContext } from "./registry.js";

export interface WorkerCliConfig {
  url: string;
  token: string;
  machineName: string;
  root: string;
}

export type WorkerConfigResult =
  | { ok: true; config: WorkerCliConfig; warnings: string[] }
  | { ok: false; error: string };

export interface WorkerConfigInput {
  args: Record<string, string | undefined>;
  env: Record<string, string | undefined>;
  fileText?: string | null;
  hostname?: string;
  cwd?: string;
  insecure?: boolean;
}

const VALUE_KEYS = new Set(["url", "token", "name", "root", "config"]);
const WORKER_USAGE_TEXT = `用法: kunpeng worker --url <ws(s)://地址> [选项]

选项:
  --url <地址>       cockpit 的 WebSocket 地址
  --token <token>    工作机 token（建议改用环境变量或配置文件）
  --name <名称>      工作机显示名称
  --root <路径>      工作目录
  --config <路径>    JSON 配置文件
  --insecure         允许远端明文 ws:// 连接

环境变量:
  KUNPENG_WORKER_TOKEN  工作机 token`;

export function parseWorkerArgs(rest: string[]): Record<string, string | undefined> {
  const parsed: Record<string, string | undefined> = {};
  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index];
    if (!argument.startsWith("--")) continue;

    const key = argument.slice(2);
    if (!VALUE_KEYS.has(key)) continue;

    const candidate = rest[index + 1];
    if (candidate !== undefined && !candidate.startsWith("--")) {
      parsed[key] = candidate;
      index += 1;
    } else {
      parsed[key] = undefined;
    }
  }
  return parsed;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function parseFileConfig(fileText: string | null | undefined):
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; error: string } {
  if (fileText === null || fileText === undefined || fileText.trim() === "") {
    return { ok: true, config: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fileText);
  } catch {
    return { ok: false, error: "配置文件不是合法 JSON" };
  }

  if (parsed === null) return { ok: true, config: {} };
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "配置文件必须是 JSON 对象" };
  }
  return { ok: true, config: parsed as Record<string, unknown> };
}

function invalidUrlError(error: unknown): string {
  const code = error !== null
    && typeof error === "object"
    && "code" in error
    && typeof error.code === "string"
    ? error.code
    : "ERR_INVALID_URL";
  return `工作机 URL 不合法（${code}）`;
}

export function resolveWorkerConfig(input: WorkerConfigInput): WorkerConfigResult {
  const fileResult = parseFileConfig(input.fileText);
  if (!fileResult.ok) return fileResult;
  const file = fileResult.config;

  const url = nonEmpty(input.args.url) ?? nonEmpty(file.url);
  if (url === undefined) return { ok: false, error: "缺少 --url" };

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch (error: unknown) {
    return { ok: false, error: invalidUrlError(error) };
  }
  if (parsedUrl.protocol !== "ws:" && parsedUrl.protocol !== "wss:") {
    return { ok: false, error: "URL 协议必须是 ws:// 或 wss://" };
  }

  const fileToken = nonEmpty(file.token);
  const envToken = nonEmpty(input.env.KUNPENG_WORKER_TOKEN);
  const argumentToken = nonEmpty(input.args.token);
  const token = fileToken ?? envToken ?? argumentToken;
  if (token === undefined) return { ok: false, error: "缺少工作机 token" };
  if (!token.startsWith("w1.")) return { ok: false, error: "token 格式不对" };

  const warnings: string[] = [];
  if (fileToken === undefined && envToken === undefined && argumentToken !== undefined) {
    warnings.push("命令行 token 会暴露在 ps 进程列表中；请改用配置文件或 KUNPENG_WORKER_TOKEN");
  }

  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (parsedUrl.protocol === "ws:" && !localHosts.has(parsedUrl.hostname)) {
    if (!input.insecure) {
      return { ok: false, error: "远端工作机连接拒绝使用明文 ws://；如确认风险请加 --insecure" };
    }
    warnings.push("已允许远端明文连接，token 和命令可能被窃听");
  }

  const machineName = nonEmpty(input.args.name)
    ?? nonEmpty(file.machineName)
    ?? nonEmpty(file.name)
    ?? nonEmpty(input.hostname)
    ?? "工作机";
  const root = nonEmpty(input.args.root)
    ?? nonEmpty(file.root)
    ?? nonEmpty(input.cwd)
    ?? ".";

  return {
    ok: true,
    config: { url, token, machineName, root },
    warnings,
  };
}

async function readOptionalConfig(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error: unknown) {
    if (
      error !== null
      && typeof error === "object"
      && "code" in error
      && error.code === "ENOENT"
    ) return undefined;
    throw error;
  }
}

async function run(context: CliContext): Promise<void> {
  if (context.rest.includes("--help") || context.rest.includes("-h")) {
    console.log(WORKER_USAGE_TEXT);
    process.exit(0);
  }

  const args = parseWorkerArgs(context.rest);
  if (args.name === undefined && context.nameArg !== undefined) args.name = context.nameArg;
  const configPath = args.config ?? join(homedir(), ".kunpeng", "worker.json");

  let fileText: string | undefined;
  try {
    fileText = await readOptionalConfig(configPath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`读取工作机配置文件失败：${message}`);
    process.exitCode = 1;
    return;
  }

  const result = resolveWorkerConfig({
    args,
    env: process.env,
    fileText,
    hostname: systemHostname(),
    cwd: process.cwd(),
    insecure: context.rest.includes("--insecure"),
  });
  if (!result.ok) {
    console.error(result.error);
    process.exitCode = 1;
    return;
  }

  for (const warning of result.warnings) console.warn(`[worker] 警告：${warning}`);
  const client = createWorkerClient({
    ...result.config,
    onStateChange: (state) => console.log(`[worker] ${state}`),
  });
  client.start();

  const stop = (): void => {
    void client.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

registerCliCommand({ name: "worker", run });
