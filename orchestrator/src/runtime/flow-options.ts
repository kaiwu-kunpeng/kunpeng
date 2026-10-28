import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExecBackendConfig } from "../agent/docker-exec.js";

/** 按项目的开发循环开关：<repoRoot>/.kunpeng/flow-options.json（人写配置）。 */
export interface FlowOptions {
  verifyEvaluator?: boolean;
  /** 执行后端：缺省本机；{ kind: "docker", image } 时 agent 进程跑在本机容器里。 */
  execBackend?: ExecBackendConfig;
}

/** 校验 execBackend；不合格返回错误文案（调用方按本机执行并告警）。 */
export function parseExecBackend(value: unknown): { backend?: ExecBackendConfig; error?: string } {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { error: "execBackend 必须是对象" };
  const raw = value as Record<string, unknown>;
  if (raw.kind !== "docker") return { error: "execBackend.kind 目前只支持 docker" };
  if (typeof raw.image !== "string" || raw.image.trim() === "") return { error: "execBackend.image 必须是非空字符串" };
  const strings = (v: unknown): string[] | undefined =>
    Array.isArray(v) && v.every((item) => typeof item === "string") ? v : undefined;
  if (raw.sharedRoots !== undefined && !strings(raw.sharedRoots)) return { error: "execBackend.sharedRoots 必须是字符串数组" };
  if (raw.extraMounts !== undefined && !strings(raw.extraMounts)) return { error: "execBackend.extraMounts 必须是字符串数组" };
  return {
    backend: {
      kind: "docker",
      image: raw.image,
      ...(raw.sharedRoots !== undefined ? { sharedRoots: raw.sharedRoots as string[] } : {}),
      ...(raw.extraMounts !== undefined ? { extraMounts: raw.extraMounts as string[] } : {}),
    },
  };
}

/** 读项目开关。文件不存在 → 空配置；写坏 → 按更严格处理（开评估器）并带回错误供调用方告警。 */
export function readFlowOptions(repoRoot: string): { options: FlowOptions; error?: string } {
  let raw: string;
  try {
    raw = readFileSync(join(repoRoot, ".kunpeng", "flow-options.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { options: {} };
    return { options: { verifyEvaluator: true }, error: `flow-options.json 读取失败：${String(error)}` };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { options: { verifyEvaluator: true }, error: "flow-options.json 必须是 JSON 对象" };
    }
    const value = (parsed as Record<string, unknown>).verifyEvaluator;
    if (value !== undefined && typeof value !== "boolean") {
      return { options: { verifyEvaluator: true }, error: "flow-options.json 的 verifyEvaluator 必须是布尔值" };
    }
    const exec = parseExecBackend((parsed as Record<string, unknown>).execBackend);
    return {
      options: { ...(value === undefined ? {} : { verifyEvaluator: value }), ...(exec.backend ? { execBackend: exec.backend } : {}) },
      ...(exec.error ? { error: `flow-options.json 的 ${exec.error}；按本机执行` } : {}),
    };
  } catch (error) {
    return { options: { verifyEvaluator: true }, error: `flow-options.json 不是合法 JSON：${String(error)}` };
  }
}

/** 评估器开关优先级：代码显式参数 > 环境变量 KUNPENG_VERIFY_EVALUATOR（"1" 开 / "0" 关）> 项目配置 > 关。 */
export function resolveVerifyEvaluator(explicit: boolean | undefined, env: string | undefined, project: FlowOptions): boolean {
  if (explicit !== undefined) return explicit;
  if (env === "1") return true;
  if (env === "0") return false;
  return project.verifyEvaluator === true;
}
