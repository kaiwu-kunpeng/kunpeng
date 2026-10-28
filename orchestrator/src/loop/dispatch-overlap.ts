import { execFile } from "node:child_process";
import type { FlowState } from "../runtime/flowstate.js";
import {
  formatObserveWarn,
  gateModeEnvKey,
  readGatesConfig,
  recordGateObservation,
  resolveGateMode,
  warnLegacyRepoGatesConfig,
  type GateMode,
} from "../runtime/gate-mode.js";
import { kunpengStateDir } from "../project/state-dir.js";
import { parseScopeDeclaration } from "../verify/scope-gate.js";

/** 派流前"触及文件集"重叠预检(纯模块,不依赖 DevCycle):
 *  同文件并行修改是假冲突 / autopilot 整批拒收 / 链式流拿旧基底的主因,所以派流前先预测本流会碰哪些文件,
 *  与在跑流的预测集(或其分支已产生的 diff)做精确路径比对。撞了怎么办由统一闸门模式决定(gate 名 dispatch-overlap,
 *  见 runtime/gate-mode.ts):observe 只告警,block 拒派(exit 4);KUNPENG_OVERLAP_STRICT=1 是最高优先级的兼容开关。
 *  每次预检(有无重叠都)追加一行观察账本 .kunpeng/gate-observations.jsonl,便于先看误报率再决定升 block。 */

export interface RunningFlowFiles { flowId: string; files: string[] }

/** 只需要 list() 的最小 tracker 形状(FlowTracker 满足;测试可传假对象)。 */
export interface RunningFlowSource {
  list(): Promise<Array<Pick<FlowState, "flowId" | "status" | "agentActive" | "predictedFiles">>>;
}

export const OVERLAP_STRICT_EXIT_CODE = 4;
/** 统一闸门里的 gate 名:gates.json 键 / env KUNPENG_GATE_MODE_DISPATCH_OVERLAP / 账本 gate 字段。 */
export const OVERLAP_GATE = "dispatch-overlap";

const GLOB_CHARS = /[*?[\]{}!]/;
const BODY_PATH_RE = /\borchestrator\/[\w./-]*\.(?:ts|md|json)\b/g;
/** 含否定词的行(禁止/不改/不动/勿…)里的路径是"别碰"不是"要碰",不计入预测。 */
const NEGATED_LINE_RE = /禁止|不改|不动|不要改|勿改|勿动|不得改|不许改|do not (?:modify|touch|change)/i;

function normalizePath(p: string): string {
  return p.trim().replace(/^\.\//, "");
}

function scopeForbid(requirement: string): string[] {
  try { return parseScopeDeclaration(requirement)?.forbid ?? []; } catch { return []; }
}

/** 预测触及文件集 = scope allow 里不含通配的精确路径 + 需求正文里 `orchestrator/…(ts|md|json)` 形态的路径,
 *  减去 scope forbid 里的精确路径;去重、保序(allow 在前,正文按出现顺序)。纯函数不抛。 */
export function predictTouchedFiles(input: { scopeAllow?: string[]; requirement: string }): string[] {
  const requirement = String(input.requirement ?? "");
  const out = new Set<string>();
  for (const raw of input.scopeAllow ?? []) {
    const p = normalizePath(String(raw));
    if (p && !GLOB_CHARS.test(p)) out.add(p);
  }
  for (const line of requirement.split(/\r?\n/)) {
    if (NEGATED_LINE_RE.test(line)) continue;
    for (const m of line.matchAll(BODY_PATH_RE)) out.add(m[0]);
  }
  for (const raw of scopeForbid(requirement)) {
    const p = normalizePath(raw);
    if (p && !GLOB_CHARS.test(p)) out.delete(p);
  }
  return [...out];
}

/** 精确路径相等即重叠(glob 不参与);只返回有撞文件的在跑流,files 按 candidate 顺序去重。纯函数。 */
export function overlapWithRunning(candidate: string[], running: RunningFlowFiles[]): RunningFlowFiles[] {
  const want = [...new Set(candidate.map(normalizePath).filter(Boolean))];
  const out: RunningFlowFiles[] = [];
  for (const r of running) {
    const theirs = new Set((r.files ?? []).map(normalizePath));
    const files = want.filter((f) => theirs.has(f));
    if (files.length) out.push({ flowId: r.flowId, files });
  }
  return out;
}

/** `git diff --name-only main...<branch>`;分支不存在 / git 失败 / 超时一律返回空数组,不抛。 */
function gitDiffNames(repoRoot: string, branch: string, timeoutMs: number): Promise<string[]> {
  return new Promise((resolve) => {
    try {
      execFile(
        "git",
        ["diff", "--name-only", `main...${branch}`],
        { cwd: repoRoot, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout) => {
          if (err) { resolve([]); return; }
          resolve(String(stdout).split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
        },
      );
    } catch { resolve([]); }
  });
}

/** 在跑流(status=running 或 agentActive)各自的文件集:state 里记了 predictedFiles 就用它,
 *  否则取其分支 kp/<flowId> 相对 main 的 diff 文件名(分支不存在 → 空数组)。任何失败都不抛。 */
export async function runningFlowFiles(
  tracker: RunningFlowSource,
  repoRoot: string,
  opts: { timeoutMs?: number } = {},
): Promise<RunningFlowFiles[]> {
  let flows: Array<Pick<FlowState, "flowId" | "status" | "agentActive" | "predictedFiles">>;
  try { flows = await tracker.list(); } catch { return []; }
  const out: RunningFlowFiles[] = [];
  for (const s of flows) {
    if (s.status !== "running" && !s.agentActive) continue;
    const files = s.predictedFiles?.length
      ? [...s.predictedFiles]
      : await gitDiffNames(repoRoot, `kp/${s.flowId}`, opts.timeoutMs ?? 5000);
    out.push({ flowId: s.flowId, files });
  }
  return out;
}

function explicitGateMode(raw: unknown): GateMode | undefined {
  const value = String(raw ?? "").trim().toLowerCase();
  return value === "observe" || value === "block" ? value : undefined;
}

/** dispatch-overlap 的模式:env KUNPENG_GATE_MODE_DISPATCH_OVERLAP > gates.json["dispatch-overlap"] > **observe**。
 *  与 gate-mode 的全局默认 block 不同:范围门/审计闸本来就是拦的、observe 是放松;而重叠预检的预测器是启发式
 *  (正文正则 + 无通配的 allow 路径),误报率未知,自诞生起就是只告警——没有任何显式配置时必须维持现状,
 *  否则合入即静默改变每个 `kunpeng run` 的行为。只有 env / gates.json 给出合法值时才交给 resolveGateMode 的既有优先级。 */
export function overlapGateMode(
  repoRoot: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  warn: (msg: string) => void = (msg) => console.warn(msg),
): GateMode {
  const stateDir = kunpengStateDir(env);
  warnLegacyRepoGatesConfig(repoRoot, stateDir, warn);
  const config = readGatesConfig(stateDir, warn);
  const explicit = explicitGateMode(env[gateModeEnvKey(OVERLAP_GATE)]) ?? explicitGateMode(config[OVERLAP_GATE]);
  return explicit ? resolveGateMode(OVERLAP_GATE, env, config) : "observe";
}

export interface PrecheckDeps {
  flowId: string;
  requirement: string;
  scopeAllow?: string[];
  tracker: RunningFlowSource;
  repoRoot: string;
  /** 兼容开关(最高优先级):缺省读 env KUNPENG_OVERLAP_STRICT === "1";为 true 时不论闸门模式一律拒派。 */
  strict?: boolean;
  /** 闸门模式:缺省 overlapGateMode(repoRoot, env)。 */
  mode?: GateMode;
  /** 缺省 process.env(strict 与 mode 都从这里读)。 */
  env?: NodeJS.ProcessEnv;
  /** 账本时间戳来源,缺省 Date.now。 */
  now?: () => number;
  log?: (line: string) => void;
  /** 拒派时调用;缺省 process.exit。 */
  exit?: (code: number) => void;
  timeoutMs?: number;
}
export interface PrecheckResult { predictedFiles: string[]; overlaps: RunningFlowFiles[]; refused: boolean; mode: GateMode }

/** run 入口接线用的一站式预检:算本流预测集 → 查在跑流(排除自己) → 记一行观察账本(有无重叠都记,无重叠是误报率分母)
 *  → 撞文件逐条打印 → strict 或 block 模式 exit(4) 拒派,observe 模式只 warn 放行。predictedFiles 由调用方随 tracker.start 落盘。 */
export async function precheckDispatchOverlap(deps: PrecheckDeps): Promise<PrecheckResult> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const env = deps.env ?? process.env;
  const strict = deps.strict ?? env.KUNPENG_OVERLAP_STRICT === "1";
  const mode = deps.mode ?? overlapGateMode(deps.repoRoot, env, log);
  const at = (deps.now ?? Date.now)();
  const predictedFiles = predictTouchedFiles({ scopeAllow: deps.scopeAllow, requirement: deps.requirement });
  const running = (await runningFlowFiles(deps.tracker, deps.repoRoot, { timeoutMs: deps.timeoutMs }))
    .filter((r) => r.flowId !== deps.flowId);
  const overlaps = overlapWithRunning(predictedFiles, running);
  if (overlaps.length === 0) {
    const reason = `预测触及 ${predictedFiles.length} 个文件,与 ${running.length} 条在跑流无重叠`;
    recordGateObservation(deps.repoRoot, { gate: OVERLAP_GATE, flowId: deps.flowId, wouldBlock: false, reason, at, mode }, log);
    log(`[派流预检] ${reason}`);
    return { predictedFiles, overlaps, refused: false, mode };
  }
  const reason = overlaps.map((o) => `${o.flowId}: ${o.files.join(", ")}`).join("; ");
  recordGateObservation(deps.repoRoot, { gate: OVERLAP_GATE, flowId: deps.flowId, wouldBlock: true, reason, at, mode }, log);
  for (const o of overlaps) log(`[派流预检] 与在跑流 ${o.flowId} 撞文件: ${o.files.join(", ")}`);
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  if (strict) {
    log(`[派流预检] KUNPENG_OVERLAP_STRICT=1,拒派(exit ${OVERLAP_STRICT_EXIT_CODE})`);
    exit(OVERLAP_STRICT_EXIT_CODE);
    return { predictedFiles, overlaps, refused: true, mode };
  }
  if (mode === "block") {
    log(`[派流预检] gate:${OVERLAP_GATE} 处于 block 模式,拒派(exit ${OVERLAP_STRICT_EXIT_CODE})`);
    exit(OVERLAP_STRICT_EXIT_CODE);
    return { predictedFiles, overlaps, refused: true, mode };
  }
  log(formatObserveWarn(OVERLAP_GATE, reason));
  log(`[派流预检] observe 模式仅告警,继续派流(升 block:.kunpeng/gates.json 写 "${OVERLAP_GATE}": "block",或 env ${gateModeEnvKey(OVERLAP_GATE)}=block)`);
  return { predictedFiles, overlaps, refused: false, mode };
}
