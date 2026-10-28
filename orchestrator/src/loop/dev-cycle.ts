import simpleGit from "simple-git";
import { isRecord } from "../util/is-record.js";
import { ArtifactStore } from "../artifacts/store.js";
import type { Workspace } from "../git/workspace.js";
import type { AgentRequest, AgentResult, AgentRunner } from "../agent/runner.js";
import type { StreamDelta } from "../agent/cli-stream-parse.js";
import { runVerification, isBlankOutput, diagnoseBlankFailure } from "../verify/gate.js";
import type { VerifyResult } from "../verify/gate.js";
import { confirmRegressions } from "../verify/diff-confirm.js";
import { appendGateDecision } from "../verify/gate-log.js";
import { parseScopeDeclaration } from "../verify/scope-gate.js";
import { formatNotRedFirst, NOT_RED_FIRST_KIND, parseShortStat } from "../verify/red-first.js";
import { evaluateScopeOnMainPath, parseChangedPaths, isMachineSpecCopy, isAgentRegistryFile, type ScopeMainVerdict } from "../verify/scope-main-gate.js";
import { EVAL_TAMPER_KIND, findEvalAssetViolations, formatEvalTamperMessage } from "../verify/eval-asset-guard.js";
import { auditAcceptanceTest } from "./audit.js";
import { auditScope } from "./scope-audit.js";
import { classifyComplexity } from "./complexity.js";
import { formatVerifyBlocker } from "./verify-blocker.js";
import { SAME_BACKEND_NOTICE } from "../agent/backend-routing.js";
import { buildEvaluatorInput, parseEvaluatorVerdict, type EvaluatorVerdict } from "../verify/evaluator.js";
import { loadStageMethodology } from "../agent/stage-methodology.js";
import { classifyAcceptOutput, writeAcceptLog } from "./rollback-attribution.js";
import type { FlowTracker } from "../runtime/flowstate.js";
import type { HarnessStamp } from "../runtime/harness-stamp.js";
import { ensureFlowTmpDir } from "../runtime/flow-tmp.js";
import { leaseTtlForStage } from "../runtime/lease-policy.js";
import { RAISE_BLOCKER_INSTRUCTION, RAISE_BLOCKER_PREFIX, parseRaiseBlocker } from "../runtime/raise-blocker.js";
import { shouldRerun } from "../runtime/idempotent.js";
import { deriveCompletedStages, DEV_CYCLE_STAGES, planFlowResume } from "../runtime/resume-plan.js";
import { createLogger, type Logger } from "../runtime/logger.js";
import { formatObserveWarn, gateModeFor, recordGateObservation } from "../runtime/gate-mode.js";
import type { KunpengEvent, OnEvent } from "../sdk/events.js";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, normalize, resolve, join } from "node:path";
import { buildRepoMapContext } from "../context/spec-context.js";
import { selectRelevantPaths } from "../context/path-select.js";
import { resolveCapturesDir } from "../knowledge/capture-store.js";
import { buildMemoryContextBM25, type Bm25MemoryCapture } from "../knowledge/memory-context.js";
import { buildGenAiSpan } from "../metrics/genai-span.js";
import { createFlowSpans, type FlowSpans, type SpanAttributes } from "../metrics/span-log.js";
import { isGarbageSpec } from "../agent/login-preflight.js";
import type { SwitchboardSender } from "../switchboard/store.js";
import { defaultPresenceBeater, startPresenceHeartbeat, type PresenceBeater } from "../switchboard/presence-heartbeat.js";
import { readFlowOptions, resolveVerifyEvaluator } from "../runtime/flow-options.js";

/** 代码智能 + 记忆（gated）：env KUNPENG_REPOMAP_CONTEXT=1 时，给 spec 段注入「现有代码地图」
 *  （repo-map 焦点骨架）+「相关经验」（KB 按场景召回）。缺省关＝行为完全不变。任何异常吞掉，绝不破坏 spec。 */
async function loadSpecRepoMap(cwd: string, requirement: string): Promise<string> {
  if (process.env.KUNPENG_REPOMAP_CONTEXT !== "1") return "";
  let out = "";
  try {
    // 两遍：先收全部路径(不读源码,快)→按相关度选 ≤300(相关文件即便排末尾也必入选,治 cap 漏文件)→只读选中源码。
    let paths: string[] = [];
    for (const rel of ["orchestrator/src", "src"]) {
      const collected: string[] = [];
      await collectTsPaths(join(cwd, rel), cwd, collected);
      if (collected.length > 0) {
        paths = collected;
        break;
      }
    }
    if (paths.length > 0) {
      const files: { path: string; source: string }[] = [];
      for (const p of selectRelevantPaths(paths, requirement, 300)) {
        try {
          files.push({ path: p, source: await readFile(join(cwd, p), "utf8") });
        } catch {
          /* 单文件读失败忽略 */
        }
      }
      if (files.length > 0) {
        const ctx = buildRepoMapContext(files, requirement, { maxChars: 1500 });
        if (ctx) out += `\n\n${ctx}`;
      }
    }
  } catch {
    /* 代码地图失败不影响记忆与 spec */
  }
  out += await loadSpecMemory(cwd, requirement);
  return out;
}

/** 记忆注入：按仓库 remote/path 定位中央 captures（flow worktree 与主仓共享），
 *  读 captures → buildMemoryContextBM25 按需求场景召回相关经验。最多读 200 条。异常吞空。 */
async function loadSpecMemory(cwd: string, requirement: string): Promise<string> {
  try {
    const capturesDir = resolveCapturesDir(cwd);
    const names = await readdir(capturesDir).catch(() => [] as string[]);
    const caps: Bm25MemoryCapture[] = [];
    for (const name of names) {
      if (caps.length >= 200) break;
      if (!name.endsWith(".json")) continue;
      try {
        const j = JSON.parse(await readFile(join(capturesDir, name), "utf8")) as {
          raw?: unknown;
          title?: unknown;
          summary?: unknown;
          tags?: unknown;
          promoted?: unknown;
          distillLevel?: unknown;
        };
        const summary = typeof j.summary === "string" ? j.summary : undefined;
        const raw = typeof j.raw === "string" ? j.raw : summary;
        if (raw === undefined) continue;
        caps.push({
          raw,
          ...(typeof j.title === "string" ? { title: j.title } : {}),
          ...(summary !== undefined ? { summary } : {}),
          tags: Array.isArray(j.tags) ? j.tags.map((t) => String(t)) : [],
          promoted: j.promoted === true,
          ...(typeof j.distillLevel === "number" ? { distillLevel: j.distillLevel } : {}),
        });
      } catch {
        /* 坏档跳过 */
      }
    }
    if (caps.length === 0) return "";
    const mem = buildMemoryContextBM25(caps, requirement, { k: 3, maxChars: 1000 });
    return mem ? `\n\n${mem}` : "";
  } catch {
    return "";
  }
}

/** 只收 .ts 相对路径（不读源码，快、无 cap）；相关性选择交给 selectRelevantPaths，再按选中读源码。 */
async function collectTsPaths(dir: string, root: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await collectTsPaths(full, root, out);
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) {
      out.push(full.startsWith(root) ? full.slice(root.length + 1) : full);
    }
  }
}

export interface DevCycleRuntimeDeps {
  store: ArtifactStore;
  ws: Workspace;
  runner: AgentRunner;
  tracker?: FlowTracker;
  acquireSlot?: () => Promise<() => Promise<void>>;
  /** 结构化日志（#10）；缺省用默认 logger。本流的日志自带 flowId（+planId/phase）correlation。 */
  logger?: Logger;
}

export interface DevCycleExecutionOptions {
  goalId?: string;
  /** 缺省时沿用 process.env.KUNPENG_REQUIRE_SCOPE === "1" 的旧语义，只有 CLI 入口显式传 resolveRequireScope(process.env)。 */
  requireScope?: boolean;
  /** 缺省 false 保持旧行为；只有 CLI 入口传 resolveRedFirst(process.env)。 */
  redFirst?: boolean;
  /** 项目级检查命令（typecheck/lint/build 等），验收通过后逐个跑，任一失败即不通过（TECHDEBT #2）。 */
  checks?: string[];
  /** 外部方案/需求直接带来的验收命令；提供时优先于 spec agent 自拟的（避免 LLM 现编脆弱测试 — P1）。 */
  acceptanceCmd?: string;
  /** 方向6 省 token：best-of-N 让 N 候选共享同一份 spec——提供时【跳过 spec 阶段、不再调 runner】，
   *  直接用此文本喂 implement，省 (N-1)× spec token。缺省时维持每流自跑 spec（行为不变）。 */
  precomputedSpec?: { text: string; meta?: Record<string, unknown> };
  /** 崩溃续跑：仅 opt-in 时允许复用已持久化的 spec artifact；implement/verify 仍重跑。 */
  resume?: boolean;
  /** S2 切片2：opt-in 时每阶段(当前:implement)后提交+打 checkpoint tag,供崩溃续跑恢复 worktree。缺省关=行为不变。 */
  checkpointStages?: boolean;
  /** 方向F-04#06 自适应拓扑：开启后,若需求判 simple 且有外部 acceptanceCmd 且未显式给 precomputedSpec,
   *  则走 lite 快路径——跳过 spec LLM 阶段,直接用 requirement 喂 implement(省一次 spec 调用)。缺省关。 */
  adaptiveTopology?: boolean;
  /** 验证失败后允许追加的同流 implement 修复次数；缺省 0，保持一次 implement 后失败即回滚。 */
  maxRepairAttempts?: number;
  /** 缺省按 resolveVerifyEvaluator：环境变量 KUNPENG_VERIFY_EVALUATOR（1/0）> 项目 .kunpeng/flow-options.json > 关。 */
  verifyEvaluator?: boolean;
}

export interface DevCycleHooks {
  presence?: PresenceBeater;
  budgetCheck?: (ctx: { flowId: string; stage: "implement" | "repair" }) => Promise<{
    level: "ok" | "warn50" | "warn80" | "halt";
    reason: string;
  } | null>;
  /** S2 切片3(pause 原语)：注入式停止判定,在阶段边界调用;返回 true 则优雅停在该边界(已建 checkpoint,可 resume 续跑)。
   *  注入而非在 dev-cycle 内 import switchboard——保持纯/可测。缺省不查=行为不变。 */
  onCheckpoint?: () => Promise<boolean>;
  /** repair 从失败转为验证通过时的可选对比教训蒸馏；调用方负责 LLM 与落盘。 */
  contrastDistill?: (input: { goal: string; failedTail: string; succeededTail: string }) => void | Promise<void>;
  /** 只读解析 flow worktree 实现前 HEAD；不传则保持现有 spec meta 语义。 */
  resolveBase?: (cwd: string) => Promise<string | undefined>;
  /** SDK/外部调用方订阅进度事件；不传时行为不变。 */
  onEvent?: OnEvent;
  /** implement 起跑前按原始需求召回历史经验；失败时按空结果继续。 */
  memoryRecall?: (requirement: string) => Promise<string[]>;
  /** Optional lifecycle-message sink shared with loop waves. */
  switchboard?: SwitchboardSender;
}

export interface DevCycleContext {
  flowId: string;
  harnessStamp?: () => Promise<HarnessStamp | undefined>;
  /** 目标库现有的 AGENTS.md/CLAUDE.md——作为子 agent 的 system，让鲲鹏与该库其他 agent 守同一套规则（多 agent 协作）。 */
  projectRules?: string;
  /** 设计 Loop:UI/设计类 flow 提供组合好的设计系统提示词(composeDesignSystemPrompt 产物);
   *  提供时在 implement/repair 阶段并进 system,让生成守设计基线+反AI味黑名单+brief。缺省不变。 */
  designSystemPrompt?: string;
  /** #6 diff 内联回灌：人工审查意见(已拼成 prompt 段);提供时注入 implement 输入,且【强制重跑 implement】(即便已完成),
   *  让审查意见真正驱动重做。缺省无=行为不变。 */
  reviewFeedback?: string;
  /** Block-A：worktree 从该 base 分叉（段间顺序，后段 off 集成分支）。缺省 off 当前 HEAD。 */
  base?: string;
  /** Block-A：plan 上下文。提供时记 planId/phase，且 plan 内的 flow 不挂 per-flow 合并门
   *  （它们自动集成进 plan 分支，合并主干门只在 plan 终点设一次）。 */
  planContext?: { planId: string; phase: number };
  logPath?: string;
  /** 工作台新任务显式选择的模型；提供时透传给每个 agent 阶段。 */
  modelOverride?: string;
  /** implement/repair 阶段传给 runner 的范围门 allow globs；其他只读阶段不挂载。 */
  scopeAllow?: string[];
  /** 派流预检预测的触及文件集；提供时随 tracker.start 落盘，供后来的流做重叠比对。 */
  predictedFiles?: string[];
}

export interface DevCycleDeps extends DevCycleRuntimeDeps, DevCycleExecutionOptions, DevCycleHooks, DevCycleContext {}
export interface DevCycleResult { status: "verified" | "rolled-back" | "stopped"; evidence?: string; }

interface StreamingAgentRunner extends AgentRunner {
  runStreaming(req: AgentRequest, onDelta: (d: StreamDelta) => void): Promise<AgentResult>;
}

export interface AuthorFile {
  path: string;
  content: string;
}

function tailUtf8(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return text;
  let start = bytes.length - maxBytes;
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start += 1;
  return bytes.subarray(start).toString("utf8");
}

function normalizeAuthorPath(path: string): string {
  const p = path.trim().replace(/^["']|["']$/g, "");
  if (!p || isAbsolute(p)) throw new Error(`invalid spec author file path: ${path}`);
  const normalized = normalize(p);
  if (normalized === "." || normalized.startsWith("..") || normalized.includes("/../") || normalized === ".git" || normalized.startsWith(".git/")) {
    throw new Error(`invalid spec author file path: ${path}`);
  }
  return normalized;
}

function authorFilesFromValue(value: unknown): AuthorFile[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (!isRecord(item) || typeof item.path !== "string" || typeof item.content !== "string") return [];
      return [{ path: normalizeAuthorPath(item.path), content: item.content }];
    });
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([path, content]) => {
      if (typeof content !== "string") return [];
      return [{ path: normalizeAuthorPath(path), content }];
    });
  }
  return [];
}

function authorFilePathFromFenceInfo(info: string): string | null {
  const trimmed = info.trim();
  const attr = /(?:^|\s)(?:path|file|filename)=("[^"]+"|'[^']+'|[^\s]+)/.exec(trimmed);
  if (attr?.[1]) return attr[1];
  const direct = /^(?:file|author-file|author_file|test-file|testfile|path)\s*[:=]?\s+(.+)$/.exec(trimmed)
    ?? /^(?:file|author-file|author_file|test-file|testfile|path):(.+)$/.exec(trimmed);
  return direct?.[1] ?? null;
}

/** Extract files authored by the spec stage so implementation cannot skip or tamper with acceptance tests. */
export function extractAuthorFilesFromSpec(text: string, meta: Record<string, unknown> = {}): AuthorFile[] {
  const files = [
    ...authorFilesFromValue(meta.authorFiles),
    ...authorFilesFromValue(meta.files),
    ...authorFilesFromValue(meta.testFiles),
  ];

  for (const match of text.matchAll(/^```([^\n`]*)\n([\s\S]*?)\n```/gm)) {
    const path = authorFilePathFromFenceInfo(match[1] ?? "");
    if (!path) continue;
    files.push({ path: normalizeAuthorPath(path), content: match[2] ?? "" });
  }

  for (const match of text.matchAll(/<file\s+path=(["'])([^"']+)\1\s*>\n?([\s\S]*?)\n?<\/file>/g)) {
    files.push({ path: normalizeAuthorPath(match[2] ?? ""), content: match[3] ?? "" });
  }

  return [...new Map(files.map((f) => [f.path, f])).values()];
}

async function writeAuthorFiles(root: string, files: AuthorFile[]): Promise<void> {
  const rootPath = resolve(root);
  for (const f of files) {
    const target = resolve(rootPath, f.path);
    if (target !== rootPath && !target.startsWith(`${rootPath}/`)) {
      throw new Error(`spec author file escapes worktree: ${f.path}`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, f.content, "utf8");
  }
}

export class DevCycle {
  private spans?: FlowSpans;
  private presenceBeater?: PresenceBeater;
  constructor(private d: DevCycleDeps) {}

  private presence(): PresenceBeater {
    return this.presenceBeater ??= this.d.presence ?? defaultPresenceBeater();
  }

  /** 外层只管 span 树的根：无论 runFlow 从哪个分支 return 或抛错，根 span 都在这里收尾。 */
  async run(requirement: string, opts: { signal?: AbortSignal } = {}): Promise<DevCycleResult> {
    const spans = createFlowSpans(join(this.d.ws.root, ".kunpeng"), this.d.flowId);
    this.spans = spans;
    const planAttrs: SpanAttributes = this.d.planContext ? { "kunpeng.plan.id": this.d.planContext.planId } : {};
    try {
      const result = await this.runFlow(requirement, opts);
      await spans.finishRoot(result.status === "verified" ? "ok" : "error", { "kunpeng.flow.status": result.status, ...planAttrs });
      return result;
    } catch (error) {
      await spans.finishRoot("error", { "kunpeng.flow.status": "error", "error.type": String(error).slice(0, 200), ...planAttrs });
      throw error;
    }
  }

  private async acquireSlotOrRecord(requirement: string): Promise<{ release?: () => Promise<void>; failed?: DevCycleResult }> {
    if (!this.d.acquireSlot) return {};
    try {
      return { release: await this.d.acquireSlot() };
    } catch (error) {
      const { flowId, tracker } = this.d;
      const reason = `[dispatch-slot-timeout] ${String(error)}`;
      await tracker?.start(flowId, requirement, {
        ...this.d.planContext, logPath: this.d.logPath,
        ...(this.d.goalId ? { goalId: this.d.goalId } : {}),
      }).catch(() => {});
      await tracker?.finish(flowId, "rolled-back", undefined, reason).catch(() => {});
      this.d.onEvent?.({ type: "done", flowId, status: "rolled-back" });
      return { failed: { status: "rolled-back", evidence: reason } };
    }
  }

  private async runFlow(requirement: string, opts: { signal?: AbortSignal }): Promise<DevCycleResult> {
    const slot = await this.acquireSlotOrRecord(requirement);
    if (slot.failed) return slot.failed;
    const releaseSlot = slot.release;
    try {
      const { store, ws, runner, flowId } = this.d;
      const t = this.d.tracker;
      const log = (this.d.logger ?? createLogger()).child({ flowId, ...(this.d.planContext ?? {}) });
      const emit = (e: KunpengEvent) => this.d.onEvent?.(this.d.planContext ? { planId: this.d.planContext.planId, ...e } : e);
      const emitFlow = (stage: string, status = "running") => emit({ type: "flow", flowId, stage, status });
      const emitDone = (status: DevCycleResult["status"]) => emit({ type: "done", flowId, status });
      const checkBudget = async (stage: "implement" | "repair"): Promise<DevCycleResult | undefined> => {
        const v = await this.d.budgetCheck?.({ flowId, stage });
        if (!v) return;
        if (v.level === "warn50" || v.level === "warn80") {
          log.warn("budget warning", { level: v.level, reason: v.reason });
        } else if (v.level === "halt") {
          await t?.block(flowId, v.reason);
          await t?.markStopped(flowId);
          emitFlow("implement", "stopped");
          emitDone("stopped");
          return { status: "stopped", evidence: `超预算暂停：${v.reason}（checkpoint 已存，处理后 kunpeng resume 续跑）` };
        }
      };
      const checkRaised = async (result: AgentResult): Promise<DevCycleResult | undefined> => {
        const raised = typeof result.meta.blocker === "string" ? result.meta.blocker : parseRaiseBlocker(result.text);
        if (!raised) return undefined;
        await t?.block(flowId, RAISE_BLOCKER_PREFIX + raised);
        await t?.markStopped(flowId);
        emitFlow("implement", "stopped");
        emitDone("stopped");
        return { status: "stopped", evidence: `agent 主动求助：${raised}（在收件箱回复后 kunpeng resume 续跑）` };
      };
      const notifyFailure = async (reason: string): Promise<void> => {
        if (!this.d.switchboard) return;
        const truncatedReason = reason.slice(0, 300);
        try {
          await this.d.switchboard.send({
            from: "dev-cycle",
            to: "all",
            topic: flowId,
            body: `flow ${flowId} failed: ${truncatedReason}`,
            kind: "failure",
            payload: { flowId, reason: truncatedReason },
            origin: { kind: "agent" },
          });
        } catch {
          // Lifecycle observability is best-effort and must not replace the original failure.
        }
      };
      let tokenQuadWrite = Promise.resolve();
      const emitUsage = (
        usage: { input?: number; output?: number; cacheCreate?: number; cacheRead?: number; model?: string },
        stage?: string,
        persistQuad = true,
      ) => {
        emit({ type: "usage", flowId, ...(stage ? { stage } : {}), ...usage });
        if (persistQuad) {
          tokenQuadWrite = tokenQuadWrite.then(async () => {
            await t?.addTokenQuad(flowId, usage);
          });
        }
        // OTel GenAI span（零依赖，只产 gen_ai.* 属性对象→落 flow 日志，供后续 cockpit trace 视图/导出消费）。
        if (stage) {
          const span = buildGenAiSpan({
            stage,
            ...(usage.model ? { model: usage.model, backend: usage.model } : {}),
            ...(typeof usage.input === "number" ? { inputTokens: usage.input } : {}),
            ...(typeof usage.output === "number" ? { outputTokens: usage.output } : {}),
          });
          log.info("genai.span", { name: span.name, ...span.attributes });
        }
      };
      const recordBackend = async (result: AgentResult, stage?: string, emitTokenFallback = true, attempt?: number) => {
        if (result.backend) await t?.setBackend(flowId, result.backend, result.fellBack);
        if (result.backend && stage) await t?.setStageBackend(flowId, stage, result.backend);
        if (result.modelUsed && stage) await t?.setStageModel(flowId, stage, result.modelUsed);
        const tk = (result.meta as { tokens?: unknown } | undefined)?.tokens;
        if (typeof tk === "number" && tk > 0) {
          await t?.addTokens(flowId, tk);
          if (stage) await t?.addStageTokens(flowId, stage, tk);
          if (attempt !== undefined) await t?.recordRepairAttempt(flowId, attempt, tk);
          if (emitTokenFallback) emitUsage({ output: tk, ...(result.backend ? { model: result.backend } : {}) }, stage, false);
        }
      };
      const runAgent = async (req: AgentRequest, stage: string): Promise<{ result: AgentResult; usageEmitted: boolean }> => {
        await t?.renewLease(flowId, leaseTtlForStage(stage));
        let lastRenewedAt = Date.now();
        let livenessFailure: { error: unknown } | undefined;
        const recordLivenessFailure = (error: unknown) => {
          livenessFailure ??= { error };
          log.warn("flow 心跳或 agent pid 落盘失败", { stage, error: String(error) });
        };
        const routedReq: AgentRequest = {
          ...req,
          ...(this.d.modelOverride ? { model: this.d.modelOverride } : {}),
          ...(opts.signal ? { signal: opts.signal } : {}),
          onSpawn: (pid) => { void t?.setAgentPid(flowId, pid).catch(recordLivenessFailure); },
        };
        const maybeStreaming = runner as Partial<StreamingAgentRunner>;
        let result: AgentResult;
        let usageEmitted = false;
        let sessionId: string | undefined;
        const spanStart = Date.now();
        let spanResult: AgentResult | undefined;
        const presenceHeartbeat = startPresenceHeartbeat({
          presence: this.presence(),
          instance: `flow:${flowId}`,
          meta: { task: stage, ...(req.cwd !== undefined ? { worktree: req.cwd } : {}) },
        });
        try {
          if (typeof maybeStreaming.runStreaming !== "function") {
            result = await runner.run(routedReq);
          } else {
            result = await maybeStreaming.runStreaming(routedReq, (delta) => {
              const at = Date.now();
              if (at - lastRenewedAt >= 15_000) {
                lastRenewedAt = at;
                void t?.renewLease(flowId, leaseTtlForStage(stage)).catch(recordLivenessFailure);
              }
              if (delta.sessionId && !sessionId) sessionId = delta.sessionId;
              if (delta.text) emit({ type: "token", flowId, text: delta.text });
              if (delta.usage) {
                usageEmitted = true;
                emitUsage(delta.usage, stage);
              }
            });
            await tokenQuadWrite;
            if (sessionId) {
              try {
                await t?.setStageSession(flowId, stage, { backend: result.backend ?? "unknown", sessionId, at: Date.now() });
              } catch (e) {
                log.warn("stageSession 落盘失败", { stage, error: String(e) });
              }
            }
          }
          spanResult = result;
        } finally {
          await presenceHeartbeat.stop();
          await t?.setAgentPid(flowId, undefined);
          const tokens = (spanResult?.meta as { tokens?: unknown } | undefined)?.tokens;
          const recorded = await this.spans?.child(`chat ${stage}`, spanStart, spanResult ? "ok" : "error", {
            "gen_ai.operation.name": "chat",
            "kunpeng.stage": stage,
            ...(spanResult?.backend ? { "gen_ai.system": spanResult.backend } : {}),
            ...(spanResult?.modelUsed ? { "gen_ai.request.model": spanResult.modelUsed } : {}),
            ...(typeof tokens === "number" ? { "kunpeng.tokens": tokens } : {}),
          });
          if (recorded === false) log.warn("span 落盘失败", { stage });
        }
        if (livenessFailure) throw livenessFailure.error;
        return { result, usageEmitted };
      };
      log.info("flow start", { requirement: requirement.slice(0, 80) });

      const resumeState = this.d.resume === true ? await t?.read(flowId) : null;
      const completedStages = resumeState ? deriveCompletedStages(resumeState) : [];
      const resumePlan = resumeState ? planFlowResume(resumeState, DEV_CYCLE_STAGES) : null;
      if (resumePlan) log.info("resume plan", { skip: resumePlan.skip, next: resumePlan.next, remaining: resumePlan.remaining });

      let harness: HarnessStamp | undefined;
      try {
        harness = await this.d.harnessStamp?.();
      } catch {
        // 印章采集是旁路，失败不得阻断流的启动或续跑。
      }

      // 续跑用 startOrResume 保留既有 history（S2 切片1：否则 start() 抹回单一 spec，多次崩溃续跑丢 replay 游标）。
      if (this.d.resume === true) {
        await t?.startOrResume(flowId, requirement, {
          ...this.d.planContext, logPath: this.d.logPath,
          ...(this.d.goalId ? { goalId: this.d.goalId } : {}),
          ...(harness ? { harness } : {}),
        });
      } else {
        await t?.start(flowId, requirement, {
          ...this.d.planContext, logPath: this.d.logPath,
          ...(this.d.goalId ? { goalId: this.d.goalId } : {}),
          ...(this.d.predictedFiles?.length ? { predictedFiles: this.d.predictedFiles } : {}),
          ...(harness ? { harness } : {}),
        });
      }

      try {
        // 先取 worktree（单写者隔离 C1），spec 阶段也在隔离 worktree 内 cwd 跑——否则
        // spec agent（claude -p acceptEdits）会把文件写进主工作树（泄漏、挡 merge，曾真发生）。
        // S2 切片5:续跑时从 checkpoint 重建 worktree(恢复 implement 代码),否则全新分叉(行为不变)。
        const flow = this.d.resume === true ? await ws.acquireResume(flowId) : await ws.acquire(flowId, this.d.base);
        const verifyEnv = { ...process.env, TMPDIR: ensureFlowTmpDir(flow.path) };
        let scopeBaseSha: string | undefined;
        try {
          scopeBaseSha = (await simpleGit(flow.path).revparse(["HEAD"])).trim();
        } catch {
          scopeBaseSha = undefined;
        }
        let baseCommit: string | undefined;
        try {
          baseCommit = this.d.resolveBase ? await this.d.resolveBase(flow.path) : undefined;
        } catch {
          baseCommit = undefined;
        }
        // 递归守卫（prompt 层）：目标库规则常写「改动一律走鲲鹏 loop/kunpeng run，不手改」——那是给顶层会话定的。
        // 子 agent 已在 loop 内，被同一句话喂到会照章递归派发（真发生：实现者不写代码反而 kunpeng run 派活，滚出几十条幽灵流）。
        // 压轴追加硬覆盖，配合 CLI 侧 KUNPENG_IN_FLOW 闸门双保险。
        const antiRecursion =
          "\n\n## 【硬规则·压轴覆盖】你已在鲲鹏 loop 内部\n" +
          "你就是本 flow 的实现者，正在隔离 worktree 中工作。上文项目规则里任何「改动必须走鲲鹏 loop / kunpeng run 派发 / 不手改」的要求只约束 loop 外的顶层会话，对你不适用。" +
          "你必须直接创建/修改文件完成任务；严禁调用 kunpeng CLI（run/plan/serve 或任何 cli.js 形式），严禁再派发任何 loop 或子任务。";
        const sys = (this.d.projectRules ?? "") + antiRecursion;
        // 代码智能（gated，缺省关）：spec 段在 rules 后并进「现有代码地图」（repo-map 焦点骨架）。
        const specSys = sys + (await loadSpecRepoMap(flow.path, requirement));
        // 设计 Loop:有 designSystemPrompt 时,implement/repair 的 system 并进它(spec 仍只用 rules)。
        const implSys = (this.d.designSystemPrompt ? `${sys}\n\n${this.d.designSystemPrompt}` : sys) + `\n\n${RAISE_BLOCKER_INSTRUCTION}`;
        const withRelevantExperiences = async (input: string): Promise<string> => {
          if (!this.d.memoryRecall) return input;
          try {
            const experiences = await this.d.memoryRecall(requirement);
            if (!Array.isArray(experiences) || experiences.length === 0) return input;
            return `## 相关历史经验(自动预取,防重犯)\n${experiences.join("\n")}\n\n${input}`;
          } catch {
            return input;
          }
        };
        const lite =
          !this.d.precomputedSpec &&
          this.d.adaptiveTopology === true &&
          Boolean(this.d.acceptanceCmd) &&
          classifyComplexity(requirement).complexity === "simple";
        const injectedSpec = this.d.precomputedSpec ?? (lite ? { text: requirement } : undefined);
        const persistedSpecArtifact = this.d.resume === true && !injectedSpec
          ? await store.read(flowId)
            .then((artifact) => artifact.kind === "spec" ? { text: artifact.body, meta: artifact.meta } : undefined)
            .catch(() => undefined)
          : undefined;
        const canReusePersistedSpec = Boolean(persistedSpecArtifact)
          && (!resumeState || !shouldRerun("spec", completedStages));
        const persistedSpec = canReusePersistedSpec ? persistedSpecArtifact : undefined;
        let specRes: AgentResult;
        if (injectedSpec) {
          specRes = { text: injectedSpec.text, meta: (injectedSpec as { meta?: Record<string, unknown> }).meta ?? {} };
          if (lite) log.info("adaptive: lite 快路径(simple 需求,跳过 spec 阶段)");
        } else if (persistedSpec) {
          specRes = { text: persistedSpec.text, meta: persistedSpec.meta };
          log.info("resume: 复用持久化 spec artifact,跳过 spec 阶段");
        } else {
          await t?.enter(flowId, "spec", true);
          emitFlow("spec");
          const agentRun = await runAgent({ stage: "spec", system: specSys, input: requirement, tools: [], cwd: flow.path }, "spec");
          specRes = agentRun.result;
          await recordBackend(specRes, "spec", !agentRun.usageEmitted);
          await t?.enter(flowId, "spec", false);
        }
        // 验证命令优先用外部方案带来的（P1，更可靠）；否则退回 spec 阶段从验收标准生成（C3，实现者仍不得自定）。
        const acceptanceCmd = this.d.acceptanceCmd || String(specRes.meta.testCmd ?? "");
        if (isGarbageSpec(specRes.text)) {
          const reason = "spec 阶段产出疑似登录失败/空响应，拒绝当作有效 spec 继续实现";
          await store.write({ kind: "spec", id: flowId, status: "draft", body: specRes.text, meta: { ...specRes.meta, ...(baseCommit ? { baseCommit } : {}) } });
          await t?.block(flowId, reason);
          await t?.finish(flowId, "rolled-back", undefined, reason);
          await ws.rollback(flowId);
          await store.transition(flowId, "rolled-back");
          await store.write({ kind: "experience", id: `exp-${flowId}-${Date.now().toString(36)}`, status: "draft",
            body: `flow ${flowId} → rolled-back (garbage spec)`, meta: { sourceFlow: flowId, outcome: "rolled-back", reason, evidence: specRes.text } });
          await notifyFailure(reason);
          emitDone("rolled-back");
          return { status: "rolled-back", evidence: reason };
        }
        // 作者锁定文件在 implement【之前】此刻固化:requirement(最高权威,实现者绝对控制不了) +
        // spec 文本/meta(此刻尚未经过 implement,实现者还无从污染)。authorFiles 是 run() 作用域 const,
        // implement/repair runner 只拿到 flow.path 工作树、改不到这个内存值;runVerifyOnce 每次 verify 前都用它
        // 还原,压过实现者篡改。关键护栏=【固化时机在 implement 之前】关闭 gaming 时序窗口,而非 verify 时再读
        // agent 可控文本(后者才是当年 flow2b-wire 被 game 的根因)。fence 抽取为白名单式(file:/author-file:/
        // <file path=>),普通示例代码块不会被误当验收文件落盘。requirement 放并集最后→路径冲突时覆盖 spec 文本,保权威。
        const authorFiles = [
          ...new Map(
            [
              ...extractAuthorFilesFromSpec(specRes.text, specRes.meta),
              ...extractAuthorFilesFromSpec(requirement, {}),
            ].map((file) => [file.path, file]),
          ).values(),
        ];
        await store.write({ kind: "spec", id: flowId, status: "draft", body: specRes.text, meta: { ...specRes.meta, ...(baseCommit ? { baseCommit } : {}) } });

        // 测试审计角色（C3 最后一道）：验收测试太弱（仅查存在/恒真）就在实现前 fail-closed，
        // 不浪费一次实现，也不让弱测试把空壳判 verified。
        await t?.enter(flowId, "audit", false);
        emitFlow("audit");
        // 审计闸接缝:判定"应拦"→ 先记观察账本;observe 模式只 warn 放行,block 模式与现状完全一致。
        const gateRoot = typeof (ws as Partial<Workspace>).root === "string" ? ws.root : undefined;
        const auditGateMode = gateModeFor("audit", gateRoot, process.env, (m) => log.warn(m));
        const observeAudit = (reason: string): boolean => {
          recordGateObservation(gateRoot, { gate: "audit", flowId, wouldBlock: true, reason, at: Date.now(), mode: auditGateMode }, (m) => log.warn(m));
          if (auditGateMode !== "observe") return false;
          log.warn(formatObserveWarn("audit", reason));
          return true;
        };
        const scopeAudit = auditScope(specRes.text, requirement);
        const requireScope = this.d.requireScope ?? (process.env.KUNPENG_REQUIRE_SCOPE === "1");
        if (!scopeAudit.strong) {
          if (requireScope && !observeAudit(`scope 审计未通过: ${scopeAudit.reason}`)) {
            await t?.block(flowId, `scope 审计未通过: ${scopeAudit.reason}`);
            const reason = `scope 审计未通过: ${scopeAudit.reason}`;
            await t?.finish(flowId, "rolled-back", undefined, reason);
            await ws.rollback(flowId);   // worktree 已提前取，audit 失败要回滚释放
            await store.transition(flowId, "rolled-back");
            await store.write({ kind: "experience", id: `exp-${flowId}-${Date.now().toString(36)}`, status: "draft",
              body: `flow ${flowId} → rolled-back (scope audit)`, meta: { sourceFlow: flowId, outcome: "rolled-back", reason } });
            await notifyFailure(reason);
            emitDone("rolled-back");
            return { status: "rolled-back", evidence: `scope 审计未通过: ${scopeAudit.reason}` };
          }
          log.info("scope audit warning", { reason: scopeAudit.reason });
        }
        const audit = auditAcceptanceTest(acceptanceCmd, { cwd: flow.path, authorFilePaths: authorFiles.map((file) => file.path) });
        if (!audit.strong && !observeAudit(`验收测试审计未通过: ${audit.reason}`)) {
          await t?.block(flowId, `验收测试审计未通过: ${audit.reason}`);
          const reason = `验收测试审计未通过: ${audit.reason}`;
          await t?.finish(flowId, "rolled-back", undefined, reason);
          await ws.rollback(flowId);   // worktree 已提前取，audit 失败要回滚释放
          await store.transition(flowId, "rolled-back");
          await store.write({ kind: "experience", id: `exp-${flowId}-${Date.now().toString(36)}`, status: "draft",
            body: `flow ${flowId} → rolled-back (audit)`, meta: { sourceFlow: flowId, outcome: "rolled-back", reason } });
          await notifyFailure(reason);
          emitDone("rolled-back");
          return { status: "rolled-back", evidence: `验收测试审计未通过: ${audit.reason}` };
        }
        await store.transition(flowId, "approved");
        await store.transition(flowId, "in-progress");

        // 差分验证基线：实现【前】先在干净 worktree 上跑各项目检查，记录已有问题。
        // 真项目基线常本就红（如缺 @types/jest），门只看我们有没有引入「基线之外」的新错。
        const baselines = new Map<string, string>();
        if (this.d.checks?.length) {
          for (const cmd of this.d.checks) {
            const first = (await runVerification({ cwd: flow.path, cmd, env: verifyEnv })).output;
            const second = (await runVerification({ cwd: flow.path, cmd, env: verifyEnv })).output;
            baselines.set(cmd, `${first}\n${second}`);
          }
        }

        // 回滚归因：每次 accept 的完整 stdout+stderr 落盘 .kunpeng/accept-logs/<flowId>/<attempt>.txt(append-only)，
        // 回滚时 kind/summary/log 一起进 FlowState 与日志——治「79.9% 回滚无归因、真实输出只在 /tmp 靠猜」。
        const kunpengDir = t ? dirname(t.stateDir) : resolve(flow.path, "..", "..");
        let lastAccept = null as { path: string; attempt: number } | null;
        const runVerifyOnce = async (): Promise<VerifyResult> => {
          await writeAuthorFiles(flow.path, authorFiles);
          let verify = acceptanceCmd
            ? await runVerification({ cwd: flow.path, cmd: acceptanceCmd, env: verifyEnv, strict: true })
            : { passed: false, output: "spec 未给出验收验证命令，无法判定完成（fails closed）", exitCode: 1 };
          const acceptRaw = verify.output;
          // 验收通过后，对项目检查做【差分】：只有引入基线之外的新错才算回归（TECHDEBT #2 + 真项目基线红）。
          if (verify.passed && this.d.checks?.length) {
            for (const cmd of this.d.checks) {
              const r = await runVerification({ cwd: flow.path, cmd, env: verifyEnv });
              if (r.passed) continue;
              const baseline = baselines.get(cmd) ?? "";
              const { regressions, flakes } = await confirmRegressions(
                { baseline, after: r.output },
                async () => ({ baseline, after: (await runVerification({ cwd: flow.path, cmd, env: verifyEnv })).output }),
              );
              if (flakes.length) {
                log.info("差分门:复验未复现,判为抖动已忽略", { cmd, flakes: flakes.slice(0, 5) });
              }
              if (t) appendGateDecision(t.stateDir, { at: Date.now(), flowId, cmd, regressions, verdict: regressions.length ? "fail" : "pass" });
              if (regressions.length) {
                verify = { passed: false, output: `项目检查 [${cmd}] 引入基线之外的新问题:\n${regressions.slice(0, 20).join("\n")}`, exitCode: r.exitCode };
                break;
              }
              // 否则：只剩基线本就有的问题（非我们引入）→ 不算回归，放行。
            }
          }
          // 治根因：失败但零输出（accept 的 test -f/grep 守卫静默挂掉、或超时被杀）→ 回滚 reason/evidence 为空、
          // 不可诊断、修复 agent 无信号。用 bash -x 重跑 accept 把失败的子命令 trace 出来，喂进 output。
          if (!verify.passed && acceptanceCmd && isBlankOutput(verify.output)) {
            verify = { ...verify, output: await diagnoseBlankFailure({ cwd: flow.path, cmd: acceptanceCmd, env: verifyEnv }) };
          }
          lastAccept = await writeAcceptLog(kunpengDir, flowId, {
            cmd: acceptanceCmd || "(none)", exitCode: verify.exitCode, passed: verify.passed, output: acceptRaw,
            phase: "final",
            ...(verify.output !== acceptRaw ? { extra: verify.output } : {}),
          });
          return verify;
        };

        if (this.d.redFirst === true && acceptanceCmd
          && !(this.d.resume === true && !shouldRerun("implement", completedStages) && !this.d.reviewFeedback)) {
          await writeAuthorFiles(flow.path, authorFiles);
          const base = await runVerification({ cwd: flow.path, cmd: acceptanceCmd, env: verifyEnv, strict: true });
          const rec = await writeAcceptLog(kunpengDir, flowId, {
            cmd: acceptanceCmd, exitCode: base.exitCode, passed: base.passed, output: base.output,
            phase: "baseline",
          });
          await t?.setAcceptEvidence(flowId, {
            baseline: {
              passed: base.passed, exitCode: base.exitCode, at: Date.now(),
              attempt: rec?.attempt ?? 1, logPath: rec?.path ?? "",
            },
          });
          if (base.passed) {
            const msg = formatNotRedFirst(base.exitCode);
            log.warn("red-first gate: acceptance already green on baseline", { exitCode: base.exitCode });
            await t?.block(flowId, msg);
            await t?.setRollback(flowId, {
              kind: NOT_RED_FIRST_KIND, summary: msg, attempt: rec?.attempt ?? 1,
              ...(rec ? { acceptLogPath: rec.path } : {}),
            });
            await t?.finish(flowId, "rolled-back", undefined, msg);
            await ws.rollback(flowId);
            await store.transition(flowId, "rolled-back");
            await store.write({ kind: "experience", id: `exp-${flowId}-${Date.now().toString(36)}`, status: "draft",
              body: `flow ${flowId} → rolled-back (red-first)`, meta: { sourceFlow: flowId, outcome: "rolled-back", reason: msg, evidence: base.output } });
            await notifyFailure(msg);
            emitDone("rolled-back");
            return { status: "rolled-back", evidence: msg };
          }
        }

        // 实现者只写代码、满足验收标准；它返回的任何 testCmd 都被忽略。
        // S2 切片5:续跑且 implement 已完成(history 已越过它)→跳过,worktree 已由 acquireResume 从 checkpoint 恢复其代码。
        // #6 回灌:有人工审查意见时【不跳过】,强制重跑 implement 把意见喂进去驱动重做。
        let implementBackend: string | undefined = resumeState?.stageBackends?.implement;
        if (this.d.resume === true && !shouldRerun("implement", completedStages) && !this.d.reviewFeedback) {
          log.info("resume: 跳过 implement(已完成,worktree 已从 checkpoint 恢复)");
        } else {
          await t?.enter(flowId, "implement", true);
          emitFlow("implement");
          if (this.d.reviewFeedback) log.info("回灌: 注入人工审查意见重跑 implement");
          const baseImplInput = this.d.reviewFeedback ? `${specRes.text}\n\n${this.d.reviewFeedback}` : specRes.text;
          const implInput = await withRelevantExperiences(baseImplInput);
          const implRun = await runAgent({
            stage: "implement", system: implSys, input: implInput, tools: ["write", "edit", "bash"], cwd: flow.path,
            ...(this.d.scopeAllow ? { scopeAllow: this.d.scopeAllow } : {}),
          }, "implement");
          await recordBackend(implRun.result, "implement", !implRun.usageEmitted);
          if (implRun.result.backend) implementBackend = implRun.result.backend;
          await t?.enter(flowId, "implement", false);
          // S2 切片2:实现后打 checkpoint(提交+tag kp-ckpt/<flowId>/implement),崩溃续跑可恢复 worktree。
          // opt-in(checkpointStages),失败吞掉不破坏主流程。
          if (this.d.checkpointStages) {
            try { await this.d.ws.checkpoint(flowId, "implement"); } catch (e) { log.info("checkpoint skip", { stage: "implement", err: String(e) }); }
          }
          const raised = await checkRaised(implRun.result);
          if (raised) return raised;
        }

        if (this.d.budgetCheck) {
          const stopped = await checkBudget("implement");
          if (stopped) return stopped;
        }

        // S2 切片3(pause 原语):implement 后(checkpoint 已存)的阶段边界查停止判定,命中则优雅暂停,可 resume 续跑。
        if (this.d.onCheckpoint && (await this.d.onCheckpoint())) {
          await t?.markStopped(flowId);
          emitFlow("implement", "stopped");
          emitDone("stopped");
          log.info("flow paused at stage boundary", { stage: "implement" });
          return { status: "stopped", evidence: "已在 implement 后暂停(checkpoint 已存,kunpeng resume 续跑)" };
        }

        const guardEvalAssets = async (attempt: number): Promise<DevCycleResult | null> => {
          if (!scopeBaseSha) return null;
          let changedFiles: string[];
          try {
            const git = simpleGit(flow.path);
            const tracked = parseChangedPaths(await git.raw(["diff", "--no-renames", "--name-only", scopeBaseSha]));
            const untracked = parseChangedPaths(await git.raw(["ls-files", "--others", "--exclude-standard"]));
            changedFiles = [...tracked, ...untracked];
          } catch (error) {
            log.warn("eval asset guard: changed files unavailable", { error: String(error) });
            return null;
          }
          const decl = parseScopeDeclaration(requirement) ?? parseScopeDeclaration(specRes.text)
            ?? (this.d.scopeAllow?.length ? { allow: this.d.scopeAllow, forbid: [] } : undefined);
          const violations = findEvalAssetViolations({
            changedFiles,
            allowGlobs: decl?.malformed === true ? [] : (decl?.allow ?? []),
            exemptPaths: authorFiles.map((file) => file.path),
            acceptanceCmd,
          });
          if (!violations.length) return null;
          const message = formatEvalTamperMessage(violations);
          const files = violations.map((violation) => violation.file);
          log.warn("eval asset guard: rolled-back", { files });
          recordGateObservation(gateRoot, { gate: EVAL_TAMPER_KIND, flowId, wouldBlock: true, reason: message, at: Date.now(), mode: "block" }, (m) => log.warn(m));
          await t?.block(flowId, message);
          await t?.setRollback(flowId, { kind: EVAL_TAMPER_KIND, summary: message.slice(0, 200), attempt });
          await t?.finish(flowId, "rolled-back", undefined, message);
          await ws.rollback(flowId);
          await store.transition(flowId, "rolled-back");
          await store.write({ kind: "experience", id: `exp-${flowId}-${Date.now().toString(36)}`, status: "draft",
            body: `flow ${flowId} → rolled-back (eval-tamper)`, meta: { sourceFlow: flowId, outcome: "rolled-back", reason: message } });
          await notifyFailure(message);
          emitDone("rolled-back");
          return { status: "rolled-back", evidence: message };
        };
        const tampered = await guardEvalAssets(1);
        if (tampered) return tampered;

        await t?.enter(flowId, "verify", true);
        emitFlow("verify");
        let verify = await runVerifyOnce();
        await t?.enter(flowId, "verify", false);

        let repairAttempts = 0;
        let failedTail = verify.passed ? "" : tailUtf8(verify.output, 4 * 1024);
        const maxRepairAttempts = this.d.maxRepairAttempts ?? 0;
        while (!verify.passed && repairAttempts < maxRepairAttempts) {
          const attempt = repairAttempts + 1;
          await t?.enter(flowId, "implement", true);
          emitFlow("implement");
          log.warn("repair attempt", { attempt, reason: verify.output.trim().slice(-160) });
          const repairInput = await withRelevantExperiences(`${specRes.text}\n\n---\n上一次实现未通过验证。诊断输出如下，请据此修复（只改代码以满足验收，不要改验收命令）：\n${formatVerifyBlocker(verify, 4000)}`);
          const repairRun = await runAgent({
            stage: "implement", system: implSys, input: repairInput, tools: ["write", "edit", "bash"], cwd: flow.path,
            ...(this.d.scopeAllow ? { scopeAllow: this.d.scopeAllow } : {}),
          }, "repair");
          await recordBackend(repairRun.result, "repair", !repairRun.usageEmitted, attempt);
          if (repairRun.result.backend) implementBackend = repairRun.result.backend;
          const raised = await checkRaised(repairRun.result);
          if (raised) return raised;
          if (this.d.budgetCheck) {
            const stopped = await checkBudget("repair");
            if (stopped) return stopped;
          }
          await t?.enter(flowId, "implement", false);
          repairAttempts++;

          const repairTampered = await guardEvalAssets(repairAttempts + 1);
          if (repairTampered) return repairTampered;

          await t?.enter(flowId, "verify", true);
          emitFlow("verify");
          verify = await runVerifyOnce();
          await t?.enter(flowId, "verify", false);
          if (!verify.passed) failedTail = tailUtf8(`${failedTail}\n${verify.output}`, 4 * 1024);
        }

        if (!verify.passed) {
          const rollback = {
            ...classifyAcceptOutput(verify.output),
            ...(lastAccept ? { acceptLogPath: lastAccept.path } : {}),
            attempt: lastAccept?.attempt ?? repairAttempts + 1,
          };
          log.warn("flow rolled-back (verification failed)", { kind: rollback.kind, summary: rollback.summary, log: rollback.acceptLogPath ?? "" });
          await t?.block(flowId, formatVerifyBlocker(verify));
          const reason = verify.output;
          await t?.setRollback(flowId, rollback);
          await t?.finish(flowId, "rolled-back", undefined, reason);
          await ws.rollback(flowId);
          await store.transition(flowId, "rolled-back");
          // 唯一 id：experience 是 append-only 语料，重跑同一 flow 不得覆盖（self-evolution 输入完整性）
          await store.write({ kind: "experience", id: `exp-${flowId}-${Date.now().toString(36)}`, status: "draft",
            body: `flow ${flowId} → rolled-back`, meta: { sourceFlow: flowId, outcome: "rolled-back", evidence: verify.output } });
          await notifyFailure(reason);
          emitDone("rolled-back");
          return { status: "rolled-back", evidence: verify.output };
        }

        if (repairAttempts > 0 && failedTail && this.d.contrastDistill) {
          try {
            await this.d.contrastDistill({
              goal: requirement,
              failedTail,
              succeededTail: tailUtf8(verify.output, 4 * 1024),
            });
          } catch (error) {
            log.warn("contrast distill failed", { error: String(error) });
          }
        }

        // 验证通过：把已验证的代码提交到 kp/<flowId> 分支留存（C2），
        // 等人工门 #1 合并主干——MVP 不自动合并。
        const sha = await ws.commit(flowId, `kp(${flowId}): verified`);
        let changedFiles: string[] | undefined;
        let changedFilesError: unknown;
        if (scopeBaseSha) {
          try {
            changedFiles = parseChangedPaths(await simpleGit(flow.path).raw(["diff", "--no-renames", "--name-only", scopeBaseSha, "HEAD"]))
              .filter((p) => !isMachineSpecCopy(p) && !isAgentRegistryFile(p));
          } catch (error) {
            changedFilesError = error;
            log.warn("changed file count unavailable", { error: String(error) });
          }
        } else {
          log.warn("changed file count unavailable: worktree HEAD unreadable");
        }
        if (changedFiles) await t?.setChangedFileCount(flowId, changedFiles.length);
        if (lastAccept) {
          await t?.setAcceptEvidence(flowId, {
            final: {
              passed: true, exitCode: verify.exitCode, at: Date.now(),
              attempt: lastAccept.attempt, logPath: lastAccept.path,
            },
          });
        }
        if (scopeBaseSha) {
          try {
            const diffStat = parseShortStat(await simpleGit(flow.path).raw(["diff", "--shortstat", scopeBaseSha, "HEAD"]));
            await t?.setAcceptEvidence(flowId, { diffStat });
          } catch (error) {
            log.warn("diff shortstat unavailable", { error: String(error) });
          }
        }
        if (!this.d.planContext) {
          const scopeDecl = parseScopeDeclaration(requirement) ?? parseScopeDeclaration(specRes.text)
            ?? (this.d.scopeAllow?.length ? { allow: this.d.scopeAllow, forbid: [] } : undefined);
          let verdict: ScopeMainVerdict;
          if (changedFiles) {
            verdict = evaluateScopeOnMainPath(changedFiles, scopeDecl, { requireScope });
          } else if (!scopeBaseSha) {
            verdict = {
              ok: false, reason: "drift", violations: [], changedFiles: [],
              message: "范围门无法确定改动基准（worktree HEAD 不可读）",
            };
          } else {
            verdict = {
              ok: false, reason: "drift", violations: [], changedFiles: [],
              message: "范围门无法读取改动文件：" + (changedFilesError instanceof Error ? changedFilesError.message : String(changedFilesError)),
            };
          }
          if (verdict.ok === false) {
            const mode = gateModeFor("scope", gateRoot, process.env, (m) => log.warn(m));
            recordGateObservation(gateRoot, { gate: "scope", flowId, wouldBlock: true, reason: verdict.message, at: Date.now(), mode }, (m) => log.warn(m));
            if (mode === "observe") {
              log.warn(formatObserveWarn("scope", verdict.message));
            } else {
              await t?.block(flowId, verdict.message);
              await t?.setRollback(flowId, {
                kind: "scope-gate", summary: verdict.message, attempt: lastAccept?.attempt ?? repairAttempts + 1,
                ...(lastAccept ? { acceptLogPath: lastAccept.path } : {}),
              });
              await t?.finish(flowId, "rolled-back", undefined, verdict.message);
              await ws.rollback(flowId);
              await store.transition(flowId, "rolled-back");
              await store.write({ kind: "experience", id: `exp-${flowId}-${Date.now().toString(36)}`, status: "draft",
                body: `flow ${flowId} → rolled-back (scope gate)`, meta: { sourceFlow: flowId, outcome: "rolled-back", reason: verdict.message } });
              await notifyFailure(verdict.message);
              emitDone("rolled-back");
              return { status: "rolled-back", evidence: verdict.message };
            }
          } else if (verdict.skipped) {
            log.info("scope gate skipped: no scope declared");
          }
        } else {
          log.info("scope gate deferred to plan-level gate");
        }
        const flowOptions = readFlowOptions(ws.root);
        if (flowOptions.error) log.warn(`${flowOptions.error}；按更严格处理，开启评估器`);
        let evaluatorGate: string | undefined;
        if (resolveVerifyEvaluator(this.d.verifyEvaluator, process.env.KUNPENG_VERIFY_EVALUATOR, flowOptions.options)) {
          await t?.enter(flowId, "verify", true);
          emitFlow("verify");
          let diff: string;
          try {
            diff = scopeBaseSha
              ? await simpleGit(flow.path).raw(["diff", scopeBaseSha, "HEAD"])
              : "(无法读取 diff：worktree 基准不可读)";
          } catch (error) {
            diff = `(无法读取 diff：${String(error)})`;
          }
          const avoid = implementBackend === "claude" || implementBackend === "codex" ? implementBackend : undefined;
          const evaluatorBackend = (this.d.runner as { backend?: unknown }).backend;
          const evaluatorHost = evaluatorBackend === "claude" || evaluatorBackend === "codex" ? evaluatorBackend : "claude";
          let evaluatorResult: AgentResult | undefined;
          let evaluation: EvaluatorVerdict;
          try {
            const { result, usageEmitted } = await runAgent({
              stage: "verify",
              system: (this.d.projectRules ?? "") + "\n\n" + loadStageMethodology("verify", evaluatorHost),
              input: buildEvaluatorInput({ requirement, spec: specRes.text, diff, acceptOutput: verify.output }),
              tools: [], cwd: flow.path,
              ...(avoid ? { avoidBackend: avoid } : {}),
            }, "verify");
            evaluatorResult = result;
            await recordBackend(result, "verify", !usageEmitted);
            evaluation = parseEvaluatorVerdict(result.text);
          } catch (error) {
            evaluation = { verdict: "inconclusive", reason: "评估器调用失败: " + String(error) };
          }
          await t?.enter(flowId, "verify", false);
          const verifyBackend = evaluatorResult?.backend ?? "unknown";
          if (avoid !== undefined && verifyBackend === avoid) log.warn(SAME_BACKEND_NOTICE);
          const { verdict: verifyVerdict, reason: verifyReason } = evaluation;
          await store.patchMeta(flowId, { verifyVerdict, verifyBackend, verifyReason });
          log.info("verify evaluator", { verdict: verifyVerdict, backend: verifyBackend, reason: verifyReason });
          if (verifyVerdict === "inconclusive" && !this.d.planContext) {
            // D8c：判不定不做终审。机械验收已过，挂人工门等人确认；门名不含「合并主干」，autopilot 不会自动合。
            evaluatorGate = `评估器无法判定·人工确认 (人工门#1)：${verifyReason.replace(/合并主干/g, "合并")}`;
            log.warn("verify evaluator inconclusive → human gate", { reason: verifyReason });
          } else if (verifyVerdict !== "pass") {
            const message = `[verify] 评估器判定 ${verifyVerdict}：${verifyReason}`;
            await t?.block(flowId, message);
            await t?.setRollback(flowId, {
              kind: "verify-evaluator", summary: message, attempt: lastAccept?.attempt ?? repairAttempts + 1,
              ...(lastAccept ? { acceptLogPath: lastAccept.path } : {}),
            });
            await t?.finish(flowId, "rolled-back", undefined, message);
            await ws.rollback(flowId);
            await store.transition(flowId, "rolled-back");
            await store.write({ kind: "experience", id: `exp-${flowId}-${Date.now().toString(36)}`, status: "draft",
              body: `flow ${flowId} → rolled-back (verify evaluator)`,
              meta: { sourceFlow: flowId, outcome: "rolled-back", reason: message, verifyVerdict, verifyBackend } });
            await notifyFailure(message);
            emitDone("rolled-back");
            return { status: "rolled-back", evidence: message };
          }
        }
        await store.patchMeta(flowId, { evidence: verify.output, commit: sha });
        await store.transition(flowId, "verified");
        await ws.release(flowId);
        await store.write({ kind: "experience", id: `exp-${flowId}-${Date.now().toString(36)}`, status: "draft",
          body: `flow ${flowId} → verified`, meta: { sourceFlow: flowId, outcome: "verified", evidence: verify.output } });
        // plan 内的 flow 自动集成进 plan 分支，不挂 per-flow 合并门（门只在 plan 终点设一次）；
        // 独立 flow（无 planContext）仍照旧挂「合并主干」门。
        if (this.d.planContext) await t?.finish(flowId, "verified");
        else {
          const gate = { gate: evaluatorGate ?? "合并主干 (人工门#1)", what: `kp/${flowId} → main` };
          await t?.finish(flowId, "verified", gate);
          emit({ type: "gate", flowId, what: gate.gate, detail: gate.what });
        }
        log.info("flow verified", { commit: sha });
        emitDone("verified");
        return { status: "verified", evidence: verify.output };
      } catch (e) {
        const reason = /write lock already held/.test(String(e))
          ? `[dispatch-lock-conflict] ${String(e)}`
          : `dev-cycle 异常: ${String(e)}`;
        await t?.block(flowId, String(e)).catch(() => {});
        await t?.finish(flowId, "rolled-back", undefined, reason).catch(() => {});
        await ws.rollback(flowId).catch(() => {});
        await store.transition(flowId, "rolled-back").catch((err) => {
          console.warn(`dev-cycle ${flowId} 标记 rolled-back 失败: ${String(err)}`);
        });
        await notifyFailure(reason);
        emitDone("rolled-back");
        throw e;
      }
    } finally {
      await releaseSlot?.();
    }
  }
}
