// 闸门模式只认 env 与状态目录 gates.json；仓内 gates.json 惰性（安全1）。
// 本模块不含任何闸门判定逻辑,只提供:模式解析、配置读取、账本追加、账本汇总。
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { kunpengStateDir } from "../project/state-dir.js";

export type GateMode = "block" | "observe";

export interface GateObservation {
  gate: string;
  flowId: string;
  wouldBlock: boolean;
  reason: string;
  /** epoch ms */
  at: number;
  /** 记录当时闸门所处模式(block 模式下也记账,便于对照)。 */
  mode?: GateMode;
}

export type GateObservationSummary = Record<string, { total: number; wouldBlock: number }>;

type Warn = (msg: string) => void;
const defaultWarn: Warn = (msg) => console.warn(msg);

/** env 键:KUNPENG_GATE_MODE_<GATE 大写、非字母数字折成下划线>,如 scope → KUNPENG_GATE_MODE_SCOPE。 */
export function gateModeEnvKey(gate: string): string {
  return `KUNPENG_GATE_MODE_${gate.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`;
}

function normalizeMode(raw: unknown): GateMode | undefined {
  const value = String(raw ?? "").trim().toLowerCase();
  return value === "observe" || value === "block" ? value : undefined;
}

/** 优先级:env KUNPENG_GATE_MODE_<GATE> > config[gate](.kunpeng/gates.json)> 默认 block。非法值视为未设。纯函数。 */
export function resolveGateMode(gate: string, env: NodeJS.ProcessEnv, config: Record<string, string> = {}): GateMode {
  return normalizeMode(env[gateModeEnvKey(gate)]) ?? normalizeMode(config[gate]) ?? "block";
}

export function gatesConfigPath(stateDir: string): string {
  return join(stateDir, "gates.json");
}

export function legacyRepoGatesConfigPath(repoRoot: string): string {
  return gatesConfigPath(join(repoRoot, ".kunpeng"));
}

export function warnLegacyRepoGatesConfig(repoRoot: string | undefined, stateDir: string, warn: Warn = defaultWarn): boolean {
  if (!repoRoot || !existsSync(legacyRepoGatesConfigPath(repoRoot))) return false;
  warn(`[gate] ${legacyRepoGatesConfigPath(repoRoot)} 已不再生效：闸门模式只认环境变量 KUNPENG_GATE_MODE_<GATE> 与 ${gatesConfigPath(stateDir)}（安全1）`);
  return true;
}

export function gateObservationsPath(repoRoot: string): string {
  return join(repoRoot, ".kunpeng", "gate-observations.jsonl");
}

/** 读 <stateDir>/gates.json → { "<gate>": "observe" | "block" }。
 *  不存在=空对象;损坏/非对象/非字符串值=warn+跳过(宪法:数据目录垢物不得砖化服务)。stateDir 缺失=空对象。 */
export function readGatesConfig(stateDir: string | undefined, warn: Warn = defaultWarn): Record<string, string> {
  if (!stateDir) return {};
  const path = gatesConfigPath(stateDir);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") warn(`[gate] 读取 ${path} 失败(按空配置继续): ${(error as Error).message}`);
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    warn(`[gate] ${path} 不是合法 JSON(按空配置继续): ${(error as Error).message}`);
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    warn(`[gate] ${path} 顶层不是对象(按空配置继续)`);
    return {};
  }
  const config: Record<string, string> = {};
  for (const [gate, mode] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof mode === "string") config[gate] = mode;
    else warn(`[gate] ${path} 中 ${gate} 的值不是字符串(忽略该项)`);
  }
  return config;
}

/** 一步到位:env > <stateDir>/gates.json > block。 */
export function gateModeFor(gate: string, repoRoot: string | undefined, env: NodeJS.ProcessEnv = process.env, warn: Warn = defaultWarn): GateMode {
  const stateDir = kunpengStateDir(env);
  warnLegacyRepoGatesConfig(repoRoot, stateDir, warn);
  return resolveGateMode(gate, env, readGatesConfig(stateDir, warn));
}

/** observe 模式放行时打的那行 warn 文案(闸门接缝与测试共用同一来源)。 */
export function formatObserveWarn(gate: string, reason: string): string {
  return `[gate:${gate}] observe 模式：本会拦下 → ${reason}`;
}

/** 追加一行 JSON 到 <repoRoot>/.kunpeng/gate-observations.jsonl。纯追加;任何失败只 warn 不抛。 */
export function recordGateObservation(repoRoot: string | undefined, observation: GateObservation, warn: Warn = defaultWarn): void {
  if (!repoRoot) {
    warn(`[gate:${observation.gate}] 未知 repoRoot,观察账本未落盘: ${observation.reason}`);
    return;
  }
  try {
    mkdirSync(join(repoRoot, ".kunpeng"), { recursive: true });
    appendFileSync(gateObservationsPath(repoRoot), `${JSON.stringify(observation)}\n`, "utf8");
  } catch (error) {
    warn(`[gate:${observation.gate}] 观察账本写入失败(忽略): ${(error as Error).message}`);
  }
}

/** 汇总账本行 → 每个 gate 的 { total, wouldBlock }。空行/坏行/缺 gate 字段的行跳过。纯函数。 */
export function summarizeGateObservations(lines: string[]): GateObservationSummary {
  const summary: GateObservationSummary = {};
  for (const line of lines) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const row = parsed as Partial<GateObservation>;
    if (typeof row.gate !== "string" || !row.gate) continue;
    const bucket = summary[row.gate] ?? (summary[row.gate] = { total: 0, wouldBlock: 0 });
    bucket.total += 1;
    if (row.wouldBlock === true) bucket.wouldBlock += 1;
  }
  return summary;
}
