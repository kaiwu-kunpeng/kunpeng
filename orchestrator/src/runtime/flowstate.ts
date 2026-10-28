import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { shouldWarnAboutStateFile } from "../objects/state-kinds.js";
import { writeFileAtomic } from "../util/atomic-write.js";
import { withFileLock } from "./filelock.js";
import { SENSITIVE_GATE_NOTE, summarizeSensitiveLabels, type SensitiveHit } from "./sensitive-paths.js";
import type { DiffShortStat } from "../verify/red-first.js";
import type { HarnessStamp } from "./harness-stamp.js";
import { resolveFlowOrigin } from "./flow-origin.js";
import type { FlowOrigin } from "./flow-origin.js";
import type { GateClearedBy, GateClearRecord, GateLedgerEntry } from "./gate-ledger-types.js";

export { parseDurationTier, type GateClearedBy, type GateDurationTier, type GateClearRecord, type GateLedgerEntry } from "./gate-ledger-types.js";

export type FlowStage = "spec" | "audit" | "implement" | "verify" | "done";
export const FLOWSTATE_SCHEMA_VERSION = 2;

export interface GatePreReviewFinding { file: string; line: number; issue: string; evidence: string }
/** 预审带证据的发现三桶（审计 P1-6）；normal 由 reviewMerge 作确定性拦截。 */
export interface GatePreReview { verdict: string; reason: string; at: number; findings?: { normal?: GatePreReviewFinding[]; nit?: GatePreReviewFinding[]; pre_existing?: GatePreReviewFinding[] } }
export interface HumanGate {
  gate: string;
  what: string;
  preReview?: GatePreReview;
}
export interface GateHold {
  kind: "guard-red" | "review-block" | "hook-failed" | "refresh-conflict" | "stale-deletion" | "stop-signal" | "tier-human" | "sensitive-park";
  reason: string;
  at: number;
}
export interface MergeTierRecord {
  tier: "auto" | "human";
  reasons: string[];
  ruleIds: string[];
  mode: "report" | "enforce";
  at: number;
}
export interface RollbackAttributionRecord { kind: string; summary: string; acceptLogPath?: string; attempt: number; source?: "accept" | "backfill" }
export interface AcceptRunEvidence {
  passed: boolean;
  exitCode: number;
  at: number;
  attempt: number;
  logPath: string;
}
export interface AcceptEvidence {
  baseline?: AcceptRunEvidence;
  final?: AcceptRunEvidence;
  diffStat?: DiffShortStat;
}
export interface BudgetNotice {
  level: "ok" | "warn50" | "warn80" | "halt";
  reason: string;
  scope: "flow" | "repo";
  spentUsd: number;
  spentTokens: number;
  at: number;
}
export interface StageSession { backend: string; sessionId: string; at: number }
export interface FlowState {
  harness?: HarnessStamp;
  schemaVersion?: number;
  version?: number;
  flowId: string;
  requirement: string;
  startedBy?: FlowOrigin;
  stage: FlowStage;
  status: "running" | "verified" | "rolled-back" | "crashed" | "stopped";
  agentActive: boolean;                 // 当前是否有子 agent 在跑本流的某阶段
  blocker?: string;                     // 卡点：失败/超时/审计未过的原因
  failureReason?: string;               // 回滚原因（rolled-back 时可选落盘，用于失败 Pareto/趋势统计）
  rollback?: RollbackAttributionRecord;  // 回滚归因：kind/summary/accept 完整日志路径/第几次 accept（治 79.9% 回滚无归因）
  acceptEvidence?: AcceptEvidence;
  humanGate?: HumanGate;                // 需人工介入：做什么
  gateHold?: GateHold;
  mergeTier?: MergeTierRecord;
  gateOpenedAt?: number;
  gateLedger?: GateLedgerEntry[];
  mergedBy?: { by: GateClearedBy; via: string; at: number; sha: string };
  sensitive?: { hits: SensitiveHit[]; at: number }; // 敏感路径打标（鉴权/PII/账号/资金）：autopilot 不得自动合并，只能人工合并门
  planId?: string;                      // 归属的方案（Block-A：plan 分解出的流带 planId）
  phase?: number;                       // 在方案里的阶段号（段间顺序）
  profileId?: string;                   // 归属的账号/场景 profile
  goalId?: string;  // 为哪个目标花的；缺省 = 未归属
  backend?: string;                     // 当前/最近一次实际使用的 agent 后端
  fellBack?: boolean;                   // 本流最近一次后端调用是否发生过回退
  tokensUsed?: number;                  // 本流累计消耗的 LLM token 数
  budget?: BudgetNotice;
  tokenQuad?: { input: number; output: number; cacheCreate: number; cacheRead: number }; // 本流累计 token 四象限
  stageTokens?: Record<string, number>; // 本流按阶段累计消耗的 LLM token 数
  repairAttempts?: number;              // 本流已执行到的最大 repair 次序
  repairAttemptTokens?: Record<string, number>; // 本流按 repair 次序累计消耗的 LLM token 数
  stageBackends?: Record<string, string>; // 本流按阶段记录的实际 agent 后端
  stageModels?: Record<string, string>; // 本流按阶段记录的实际模型/effort 标签
  stageSessions?: Record<string, StageSession>;
  receiptSource?: "stream" | "backfill";
  pid?: number;                         // 启动本流的主人进程 pid，用于启动时崩溃判定
  agentPid?: number;                    // 当前在跑的后端子进程 pid
  host?: string;                        // 启动本流的主人主机名
  lease?: { renewedAt: number; ttlMs: number }; // 运行中流的心跳租约
  stall?: { detectedAt: number; leaseAgeMs: number; note: string };
  logPath?: string;                     // 本流子进程日志路径，A3 驾驶舱查看用
  resumeAttempts?: number;              // 自动 resume 已尝试次数，防崩溃循环
  predictedFiles?: string[];            // 派流预检预测的触及文件集（后来者据此查重叠）
  changedFileCount?: number;            // verified 提交相对分叉点的改动文件数，剔除 plan 归档副本与 agent 登记文件；给尺子判复杂度用。
  startedAt: number;
  updatedAt: number;
  history: { stage: string; at: number }[];
}

export function isFlowStateShape(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return false;
  const flowId = (raw as Record<string, unknown>).flowId;
  return typeof flowId === "string" && flowId.length > 0;
}

// v2 = 新增可选 goalId，v1 记录没有 goalId 即视为未归属，不改写其它字段。
export function migrateFlowState(raw: unknown): FlowState {
  if (!isFlowStateShape(raw)) {
    throw new TypeError("Invalid FlowState");
  }

  const state = raw as Record<string, unknown>;
  const schemaVersion = state.schemaVersion;
  return {
    ...state,
    schemaVersion:
      typeof schemaVersion === "number" && schemaVersion >= FLOWSTATE_SCHEMA_VERSION
        ? schemaVersion
        : FLOWSTATE_SCHEMA_VERSION,
  } as unknown as FlowState;
}

export function describeSkippedStateFile(filePath: string, err: unknown): string {
  if (err instanceof TypeError && err.message.includes("Invalid FlowState")) {
    return `[flowstate] 非流状态文件，已跳过：${filePath}`;
  }
  return `[flowstate] 流状态文件损坏，已跳过：${filePath} — ${String(err)}`;
}

const warnedSkippedStateFiles = new Set<string>();

export function shouldWarnSkippedStateFile(filePath: string): boolean {
  if (warnedSkippedStateFiles.has(filePath)) return false;
  warnedSkippedStateFiles.add(filePath);
  return true;
}

export function resetSkippedStateFileWarnings(): void {
  warnedSkippedStateFiles.clear();
  warnedNonFlowDirs.clear();
}

const warnedNonFlowDirs = new Set<string>();

/** 一次扫描里跳过的「非流状态文件」汇总成一行；同一目录每进程只报一次（别的项目把业务记录放进 state 目录时，
 *  逐文件告警会每轮刷上百行，淹没真问题）。返回 undefined 表示不用再报。 */
export function describeSkippedNonFlowFiles(dir: string, files: readonly string[]): string | undefined {
  if (files.length === 0 || warnedNonFlowDirs.has(dir)) return undefined;
  warnedNonFlowDirs.add(dir);
  return `[flowstate] ${dir} 下有 ${files.length} 个非流状态文件，已跳过（如 ${files[0]}）`;
}

/** start / startOrResume 可附带落盘的可选字段。 */
export type FlowStartExtra = Pick<FlowState, "planId" | "phase" | "logPath" | "profileId" | "predictedFiles">;
export type FlowStartGoal = { goalId?: string };
export type FlowStartHarness = { harness?: HarnessStamp };

export class FlowStateConflictError extends Error {
  constructor(public readonly flowId: string, public readonly expected: number, public readonly actual: number) {
    super(`FlowState ${flowId} version conflict: expected ${expected}, actual ${actual}`);
    this.name = "FlowStateConflictError";
  }
}

/** 流状态写锁目录。生产状态目录恒为 <repo>/.kunpeng/state，锁放在兄弟目录 .kunpeng/locks/state
 *  （新旧进程靠同一位置互斥，勿改）；其它目录名（测试用的临时目录）把锁放进自己目录，
 *  免得并行测试在公共临时根下共用 <tmp>/locks/state/<flowId> 一把锁而偶发 EINVAL。 */
export function flowLockDir(stateDir: string, flowId: string): string {
  return basename(stateDir) === "state"
    ? join(dirname(stateDir), "locks", "state", flowId)
    : join(stateDir, ".locks", flowId);
}

export class FlowTracker {
  private static saves = new Map<string, Promise<unknown>>();
  private writes = new Map<string, Promise<unknown>>();
  constructor(
    private dir: string,
    private now: () => number = Date.now,
    private env: Record<string, string | undefined> = process.env,
  ) {}
  get stateDir(): string { return this.dir; }
  private path(flowId: string) { return join(this.dir, `${flowId}.json`); }

  private async readVersion(flowId: string): Promise<number> {
    try {
      const state = JSON.parse(await readFile(this.path(flowId), "utf8")) as { version?: number } | null;
      return state?.version ?? 0;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
  }

  async compareAndSave(s: FlowState): Promise<void> {
    const lockDir = flowLockDir(this.dir, s.flowId);
    // 同进程实例共享提交队列，避免同时抢锁时把尚未写完的 owner 当成死锁。
    // 只串行提交；mutate 闭包仍在队列与文件锁外运行，可调用另一实例。
    await this.queueWrite(resolve(lockDir), () => withFileLock(lockDir, async () => {
      const onDisk = await this.readVersion(s.flowId);
      const expected = s.version ?? 0;
      if (process.env.KUNPENG_STATE_CAS !== "0" && expected !== onDisk) {
        throw new FlowStateConflictError(s.flowId, expected, onDisk);
      }
      // 崩溃已即时记入 failureReason；退役落盘时补上退役归因，并保留原始崩溃原因。
      if (s.status === "rolled-back" && s.history.at(-1)?.stage === "retired-superseded"
        && s.failureReason !== undefined && !s.failureReason.startsWith("[retired-superseded]")) {
        s.failureReason = `[retired-superseded] 崩溃流分支 kp/${s.flowId} 已被主干吸收或已不存在，自动退役；崩溃时卡点：${s.failureReason}`;
      }
      await writeFileAtomic(
        this.path(s.flowId),
        JSON.stringify({ ...s, version: onDisk + 1, schemaVersion: FLOWSTATE_SCHEMA_VERSION }, null, 2),
      );
      s.version = onDisk + 1;
    }, { pollMs: 15, staleMs: 30_000, timeoutMs: 30_000 }), FlowTracker.saves);
  }

  private queueWrite<T>(flowId: string, fn: () => Promise<T>, writes = this.writes): Promise<T> {
    const prev = writes.get(flowId);
    const write = (async () => {
      // 前一写入的错误由其调用方接收，不让它阻断本流后续写入。
      await prev?.catch(() => undefined);
      return fn();
    })();
    writes.set(flowId, write);
    const clear = () => {
      if (writes.get(flowId) === write) writes.delete(flowId);
    };
    void write.then(clear, clear);
    return write;
  }

  private async retryConflicts<T>(fn: () => Promise<T>, attempts = 32): Promise<T> {
    let lastConflict: FlowStateConflictError | undefined;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        if (!(error instanceof FlowStateConflictError)) throw error;
        lastConflict = error;
        if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 11)));
      }
    }
    throw lastConflict ?? new RangeError("FlowState mutation requires at least one attempt");
  }

  /** 闭包在文件锁外运行，冲突时重放；不得调用同实例的 read 或写方法。 */
  async mutate(
    flowId: string,
    fn: (s: FlowState) => void | false | Promise<void | false>,
    opts?: { attempts?: number },
  ): Promise<FlowState | null> {
    return this.queueWrite(flowId, () => this.retryConflicts(async () => {
      const s = await this.readRaw(flowId);
      if (s === null) return null;
      if (await fn(s) === false) return s;
      await this.compareAndSave(s);
      return s;
    }, opts?.attempts));
  }

  async start(flowId: string, requirement: string, extra?: FlowStartExtra & FlowStartGoal & FlowStartHarness & Pick<FlowState, "startedBy">): Promise<void> {
    const t = this.now();
    await this.queueWrite(flowId, () => this.retryConflicts(async () => {
      const version = await this.readVersion(flowId);
      await this.compareAndSave({
        flowId,
        requirement,
        stage: "spec",
        status: "running",
        agentActive: false,
        pid: process.pid,
        host: os.hostname(),
        startedAt: t,
        updatedAt: t,
        history: [{ stage: "spec", at: t }],
        startedBy: resolveFlowOrigin(this.env),
        ...extra,
        version,
      });
    }));
  }
  async startOrResume(flowId: string, requirement: string, extra?: FlowStartExtra & FlowStartGoal & FlowStartHarness & Pick<FlowState, "startedBy">): Promise<void> {
    const existing = await this.read(flowId);
    if (existing === null) {
      await this.start(flowId, requirement, extra);
      return;
    }
    await this.mutate(flowId, (s) => {
      Object.assign(s, {
        requirement,
        status: "running",
        agentActive: false,
        pid: process.pid,
        host: os.hostname(),
        updatedAt: this.now(),
        ...extra,
        startedBy: s.startedBy ?? resolveFlowOrigin(this.env),
      });
    });
  }
  async enter(flowId: string, stage: FlowStage, agentActive: boolean): Promise<void> {
    await this.mutate(flowId, (s) => {
      s.stage = stage; s.agentActive = agentActive; s.updatedAt = this.now();
      if (s.history[s.history.length - 1]?.stage !== stage) s.history.push({ stage, at: s.updatedAt });
    });
  }
  async block(flowId: string, blocker: string): Promise<void> {
    await this.mutate(flowId, (s) => {
      s.blocker = blocker; s.agentActive = false; s.updatedAt = this.now();
    });
  }
  async setBudgetNotice(flowId: string, notice: BudgetNotice): Promise<void> {
    await this.mutate(flowId, (s) => {
      s.budget = notice;
      s.updatedAt = this.now();
    });
  }
  async setBackend(flowId: string, backend: string, fellBack?: boolean): Promise<void> {
    await this.mutate(flowId, (s) => {
      s.backend = backend; s.fellBack = fellBack; s.updatedAt = this.now();
    });
  }
  async setChangedFileCount(flowId: string, count: number): Promise<void> {
    await this.mutate(flowId, (s) => {
      if (!Number.isSafeInteger(count) || count < 0) return false;
      s.changedFileCount = count;
      s.updatedAt = this.now();
    });
  }
  async setAcceptEvidence(flowId: string, patch: Partial<AcceptEvidence>): Promise<void> {
    await this.mutate(flowId, (s) => {
      s.acceptEvidence = { ...(s.acceptEvidence ?? {}), ...patch };
      s.updatedAt = this.now();
    });
  }
  async addTokens(flowId: string, tokens: number): Promise<void> {
    await this.mutate(flowId, (s) => {
      s.tokensUsed = (s.tokensUsed ?? 0) + (Number.isFinite(tokens) && tokens > 0 ? tokens : 0);
      s.updatedAt = this.now();
    });
  }
  async addTokenQuad(
    flowId: string,
    quad: Partial<{ input: number; output: number; cacheCreate: number; cacheRead: number }>,
  ): Promise<void> {
    await this.mutate(flowId, (s) => {
      const current = s.tokenQuad ?? { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
      for (const key of ["input", "output", "cacheCreate", "cacheRead"] as const) {
        const value = quad[key];
        if (typeof value === "number" && Number.isFinite(value) && value > 0) current[key] += value;
      }
      s.tokenQuad = current;
      s.updatedAt = this.now();
    });
  }
  async addStageTokens(flowId: string, stage: string, tokens: number): Promise<void> {
    await this.mutate(flowId, (s) => {
      const m = s.stageTokens ?? {};
      m[stage] = (m[stage] ?? 0) + (Number.isFinite(tokens) && tokens > 0 ? tokens : 0);
      s.stageTokens = m;
      s.updatedAt = this.now();
    });
  }
  async recordRepairAttempt(flowId: string, attempt: number, tokens: number): Promise<void> {
    await this.mutate(flowId, (s) => {
      s.repairAttempts = Math.max(s.repairAttempts ?? 0, attempt);
      if (Number.isFinite(tokens) && tokens > 0) {
        const m = s.repairAttemptTokens ?? {};
        const key = String(attempt);
        m[key] = (m[key] ?? 0) + tokens;
        s.repairAttemptTokens = m;
      }
      s.updatedAt = this.now();
    });
  }
  async setStageBackend(flowId: string, stage: string, backend: string): Promise<void> {
    await this.mutate(flowId, (s) => {
      const m = s.stageBackends ?? {};
      m[stage] = backend;
      s.stageBackends = m;
      s.updatedAt = this.now();
    });
  }
  async setStageSession(flowId: string, stage: string, session: StageSession): Promise<void> {
    await this.mutate(flowId, (s) => {
      s.stageSessions = { ...(s.stageSessions ?? {}), [stage]: session };
      s.updatedAt = this.now();
    });
  }
  async setReceiptSource(flowId: string, source: "stream" | "backfill"): Promise<void> {
    await this.mutate(flowId, (s) => {
      s.receiptSource = source;
      s.updatedAt = this.now();
    });
  }
  async setStageModel(flowId: string, stage: string, label: string): Promise<void> {
    await this.mutate(flowId, (s) => {
      const m = s.stageModels ?? {};
      m[stage] = label;
      s.stageModels = m;
      s.updatedAt = this.now();
    });
  }
  private async updateLiveness(flowId: string, update: (s: FlowState) => void): Promise<void> {
    // onSpawn/onDelta 不等待回调；mutate 同步挂入队列，后续读取和清理会等本轮落盘。
    await this.mutate(flowId, (s) => {
      update(s);
      s.updatedAt = this.now();
    });
  }
  async setAgentPid(flowId: string, pid: number | undefined): Promise<void> {
    await this.updateLiveness(flowId, (s) => {
      if (pid === undefined) delete s.agentPid;
      else s.agentPid = pid;
    });
  }
  async markStalled(flowId: string, info: { detectedAt: number; leaseAgeMs: number; note: string }): Promise<void> {
    await this.mutate(flowId, (s) => {
      s.stall = info;
      s.history.push({ stage: "stalled", at: info.detectedAt });
      s.updatedAt = this.now();
    });
  }
  async renewLease(flowId: string, ttlMs = 120000): Promise<void> {
    await this.updateLiveness(flowId, (s) => {
      s.lease = { renewedAt: this.now(), ttlMs };
      delete s.stall;
    });
  }
  async setResumeAttempts(flowId: string, resumeAttempts: number): Promise<void> {
    await this.mutate(flowId, (s) => {
      s.resumeAttempts = resumeAttempts;
      s.updatedAt = this.now();
    });
  }
  async setRollback(flowId: string, rollback: RollbackAttributionRecord): Promise<void> {
    await this.mutate(flowId, (s) => {
      s.rollback = rollback; s.updatedAt = this.now();
    });
  }
  async finish(flowId: string, status: "verified" | "rolled-back", humanGate?: HumanGate, reason?: string): Promise<void> {
    await this.mutate(flowId, (s) => {
      if (status === "rolled-back") {
        for (const candidate of [reason, s.blocker, humanGate?.what]) {
          if (typeof candidate === "string" && candidate.trim() !== "") {
            s.failureReason = candidate;
            break;
          }
        }
      }
      if (humanGate) s.gateOpenedAt = this.now();
      else delete s.gateOpenedAt;
      delete s.gateHold;
      s.stage = "done"; s.status = status; s.agentActive = false; s.humanGate = humanGate; delete s.blocker; s.updatedAt = this.now();
    });
  }
  /** 敏感路径打标:落 sensitive 字段,并把人工门文案缀上敏感说明。保留「合并主干」前缀不动——
   *  收件箱/通知/autopilot 候选过滤/reconcile 都靠它识别合并门;没有门时补一扇标准合并门。幂等。 */
  async markSensitive(flowId: string, hits: SensitiveHit[]): Promise<void> {
    await this.mutate(flowId, (s) => {
      const at = this.now();
      s.sensitive = { hits, at };
      if (!s.humanGate) s.gateOpenedAt = at;
      const gate = s.humanGate ?? { gate: "合并主干 (人工门#1)", what: `kp/${flowId} → main` };
      if (!gate.gate.includes(SENSITIVE_GATE_NOTE)) gate.gate = `${gate.gate} · ${SENSITIVE_GATE_NOTE}：${summarizeSensitiveLabels(hits)}`;
      s.humanGate = gate;
      s.updatedAt = at;
      s.history.push({ stage: "sensitive-marked", at });
    });
  }
  async markCrashed(flowId: string, reason?: string): Promise<void> {
    await this.mutate(flowId, (s) => {
      s.status = "crashed";
      s.agentActive = false;
      s.blocker = reason ?? "主人进程已崩溃（启动时判定）";
      s.failureReason = s.blocker;
      delete s.agentPid;
      s.updatedAt = this.now();
      s.history.push({ stage: "crashed", at: s.updatedAt });
    });
  }
  async markStopped(flowId: string): Promise<void> {
    await this.mutate(flowId, (s) => {
      s.status = "stopped";
      s.agentActive = false;
      s.updatedAt = this.now();
      s.history.push({ stage: "stopped", at: s.updatedAt });
    });
  }
  async clearGate(flowId: string, clearedBy: GateClearRecord = { by: "unknown", via: "unattributed" }): Promise<void> {
    await this.mutate(flowId, (s) => {
      const closedAt = this.now();
      if (s.humanGate) {
        const openedAt = s.gateOpenedAt ?? s.updatedAt;
        (s.gateLedger ??= []).push({
          gate: s.humanGate.gate,
          what: s.humanGate.what,
          openedAt,
          closedAt,
          durationMs: closedAt - openedAt,
          by: clearedBy.by,
          via: clearedBy.via,
          ...(clearedBy.durationTier !== undefined ? { durationTier: clearedBy.durationTier } : {}),
          planGate: flowId.startsWith("plan-"),
        });
      }
      s.humanGate = undefined; delete s.gateOpenedAt; delete s.gateHold; s.updatedAt = closedAt;
      s.history.push({ stage: "gate-cleared", at: s.updatedAt });
    });
  }
  async setGateHold(flowId: string, hold: GateHold): Promise<void> {
    await this.mutate(flowId, (s) => {
      s.gateHold = hold;
      s.updatedAt = this.now();
    });
  }
  async setMergeTier(flowId: string, rec: MergeTierRecord): Promise<void> {
    await this.mutate(flowId, (s) => {
      s.mergeTier = rec;
      s.updatedAt = this.now();
    });
  }
  async setGatePreReview(
    flowId: string,
    preReview: GatePreReview,
  ): Promise<void> {
    await this.mutate(flowId, (s) => {
      if (!s.humanGate) return false;
      s.humanGate.preReview = preReview;
      s.updatedAt = this.now();
      s.history.push({ stage: "gate-prereviewed", at: s.updatedAt });
    });
  }
  async clearBlocker(flowId: string): Promise<void> {
    await this.mutate(flowId, (s) => {
      if (!s.blocker) return false;
      delete s.blocker;
      s.updatedAt = this.now();
      s.history.push({ stage: "blocker-cleared", at: s.updatedAt });
    });
  }
  async read(flowId: string): Promise<FlowState | null> {
    await this.writes.get(flowId);
    return this.readRaw(flowId);
  }
  private async readRaw(flowId: string): Promise<FlowState | null> {
    try {
      return migrateFlowState(JSON.parse(await readFile(this.path(flowId), "utf8")) as unknown);
    } catch {
      return null;
    }
  }
  async list(): Promise<FlowState[]> {
    try {
      const files = (await readdir(this.dir)).filter((f) => f.endsWith(".json"));
      const flows: FlowState[] = [];
      const nonFlow: string[] = [];
      for (const file of files) {
        try {
          flows.push(
            migrateFlowState(JSON.parse(await readFile(join(this.dir, file), "utf8")) as unknown),
          );
        } catch (e) {
          const filePath = join(this.dir, file);
          if (!shouldWarnAboutStateFile(filePath)) continue;
          // 非流形状（别的业务记录）汇总成一行；损坏的流文件仍逐个告警，那才需要人看。
          if (e instanceof TypeError && e.message.includes("Invalid FlowState")) nonFlow.push(file);
          else if (shouldWarnSkippedStateFile(filePath)) console.warn(describeSkippedStateFile(filePath, e));
        }
      }
      const summary = describeSkippedNonFlowFiles(this.dir, nonFlow);
      if (summary) console.warn(summary);
      return flows;
    } catch { return []; }
  }
}
