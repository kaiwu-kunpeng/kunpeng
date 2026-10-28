import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import simpleGit from "simple-git";
import { ArtifactStore } from "../artifacts/store.js";
import { Workspace } from "../git/workspace.js";
import { resolveDefaultBranch } from "../git/default-branch.js";
import { FlowTracker, type FlowState } from "../runtime/flowstate.js";
import { computeHarnessStamp, defaultOrchestratorRoot } from "../runtime/harness-stamp.js";
import type { AgentRunner } from "../agent/runner.js";
import { DevCycle, type DevCycleHooks, type DevCycleRuntimeDeps } from "../loop/dev-cycle.js";
import { safeMerge } from "../git/merge.js";
import { resolveRunBudget, budgetHalt, sumFlowUsd } from "../runtime/run-budget.js";
import { mergeAndClearGate } from "../runtime/merge-gate.js";
import { sensitiveHitsForBranch } from "../runtime/sensitive-branch.js";
import { SENSITIVE_GATE_NOTE, summarizeSensitiveLabels, type SensitiveHit } from "../runtime/sensitive-paths.js";
import { isPauseRequested } from "../runtime/pause-marker.js";
import { runVerification } from "../verify/gate.js";
import { confirmRegressions } from "../verify/diff-confirm.js";
import { appendGateDecision } from "../verify/gate-log.js";
import { detectScopeDrift, parseScopeDeclaration } from "../verify/scope-gate.js";
import type { ScopeViolation } from "../verify/scope-gate.js";
import { isMachineSpecCopy, isAgentRegistryFile } from "../verify/scope-main-gate.js";
export { isMachineSpecCopy, isAgentRegistryFile } from "../verify/scope-main-gate.js";
import { createLogger, type Logger } from "../runtime/logger.js";
import { formatObserveWarn, gateModeFor, recordGateObservation } from "../runtime/gate-mode.js";
import { runPool } from "./pool.js";
import type { PlanModel, PlanResult, PlanFlowResult } from "./types.js";
import type { KunpengEvent, OnEvent } from "../sdk/events.js";
import { join } from "node:path";
import { relevantExperiences } from "../loop/memory-recall.js";
import { noopMirror, type FlowMirror } from "../taskboard/loop-mirror.js";
import { fileSwitchboardSender } from "../switchboard/default-sender.js";

/** 集成检查门（治本反复出现的「集成才爆 tsc」）：整条 plan 跑完、挂合并主干门前，
 *  在【集成分支】跑一遍项目 checks（typecheck/lint/build），差分扣掉【base】基线本就有的错，
 *  只要还有「base 之外的新错」就拦——因为跨流（尤其同段并行）的类型不一致逃过了单流 vitest 验收。
 *  用临时 worktree（fork 自各分支、软链 node_modules），跑完即清。*/
async function integrationCheckGate(
  ws: Workspace, repoRoot: string, integrationBranch: string, defaultBranch: string,
  checks: string[], idSuffix: string, stateDir: string, log: Logger,
): Promise<{ ok: boolean; newErrors: string[] }> {
  if (!checks.length) return { ok: true, newErrors: [] };
  const baseId = `igate-base-${idSuffix}`;
  const intId = `igate-int-${idSuffix}`;
  const baseWt = await ws.acquire(baseId, defaultBranch);
  let intWt;
  try { intWt = await ws.acquire(intId, integrationBranch); }
  catch (e) { await ws.rollback(baseId).catch(() => {}); throw e; }
  try {
    const newErrors: string[] = [];
    for (const cmd of checks) {
      const sample = async () => ({
        baseline: (await runVerification({ cwd: baseWt.path, cmd, timeoutMs: 300_000 })).output,
        after: (await runVerification({ cwd: intWt.path, cmd, timeoutMs: 300_000 })).output,
      });
      const { regressions, flakes } = await confirmRegressions(await sample(), sample);
      if (flakes.length) {
        log.info("集成检查门:复验未复现,判为抖动已忽略", { cmd, flakes: flakes.slice(0, 5) });
      }
      appendGateDecision(stateDir, { at: Date.now(), flowId: integrationBranch, cmd, regressions, verdict: regressions.length ? "fail" : "pass" });
      newErrors.push(...regressions);
    }
    return { ok: newErrors.length === 0, newErrors };
  } finally {
    await ws.rollback(baseId).catch(() => {});
    await ws.rollback(intId).catch(() => {});
  }
}

export function planScopeViolations(
  specText: string,
  changedFiles: string[],
): ScopeViolation[] {
  const decl = parseScopeDeclaration(specText);
  if (!decl) return [];
  // plan 写入的 spec 文件是机器留档产物，并非实现者可控的改动。
  // 因此在范围漂移判定前豁免这些精确匹配的归档副本。
  const implementationFiles = changedFiles.filter(
    (path) => !isMachineSpecCopy(path) && !isAgentRegistryFile(path),
  );
  return detectScopeDrift(implementationFiles, decl).violations;
}

export function makePlanId(now: number): string {
  return `plan-${now.toString(36)}-${randomBytes(3).toString("hex")}`;
}

export interface RunPlanDeps {
  goalId?: string;
  repoRoot: string;
  store: ArtifactStore;
  ws: Workspace;
  tracker: FlowTracker;
  runner: AgentRunner;
  budgetCheck?: DevCycleHooks["budgetCheck"];
  acquireSlot?: DevCycleRuntimeDeps["acquireSlot"];
  checks?: string[];
  requireScope?: boolean;
  redFirst?: boolean;
  projectRules?: string;
  concurrency?: number;
  /** 方案文件路径，rerun 整条 plan 用。 */
  planRef?: string;
  now?: () => number;   // 注入便于测试；默认 Date.now
  logPath?: string;
  logger?: Logger;      // 结构化日志（#10）；缺省用默认 logger
  /** SDK/外部调用方订阅 plan 进度事件；不传时行为不变。 */
  onEvent?: OnEvent;
  /** ADR-0009 打断检查点：每个段入口调用，返回 true = 收到本实例的停止信号，优雅停在该段前。不传时行为不变。 */
  onCheckpoint?: () => Promise<boolean>;
  /** 可选的 flow 生命周期旁路镜像；异常不得改变真实 flow 结果。 */
  mirror?: FlowMirror;
  mergeAndClearGate?: typeof mergeAndClearGate;
  sensitiveHits?: typeof sensitiveHitsForBranch;
}

/** 阶段化执行引擎：段内并行单写者、段间顺序（后段 off 集成分支）、失败停段、终点单门（合并主干）。
 *  集成分支 kp/plan-<id> 绝不碰 main——整条 plan 跑完才挂「合并主干」人工门交人（C5）。 */
export async function runPlan(model: PlanModel, d: RunPlanDeps): Promise<PlanResult> {
  const now = d.now ?? Date.now;
  const planId = makePlanId(now());
  const integrationBranch = `kp/${planId}`;
  const g = simpleGit(d.repoRoot);
  const currentBranch = (await g.branchLocal()).current;
  const defaultBranch = await resolveDefaultBranch({
    symbolicRef: () => g.raw(["symbolic-ref", "refs/remotes/origin/HEAD"]),
    fallback: currentBranch,
  });
  const log = (d.logger ?? createLogger()).child({ planId });
  const emit = (e: KunpengEvent) => d.onEvent?.(e);
  const experienceStore = new ArtifactStore(join(d.repoRoot, ".kunpeng", "artifacts"));
  let scopeAllow: string[] | undefined;
  if (d.planRef) {
    try {
      const specText = await readFile(d.planRef, "utf8");
      const decl = parseScopeDeclaration(specText);
      scopeAllow = decl?.allow.length ? decl.allow : undefined;
    } catch {
      // Missing/unreadable plan specs remain non-fatal for legacy callers.
    }
  }
  let experienceCache: Promise<Awaited<ReturnType<ArtifactStore["list"]>>> | undefined;
  const memoryRecall = async (requirement: string): Promise<string[]> => {
    experienceCache ??= experienceStore.list("experience").catch(() => []);
    const experiences = await experienceCache;
    return relevantExperiences(
      requirement,
      experiences.map((artifact) => ({
        ...(typeof artifact.meta.title === "string" ? { title: artifact.meta.title } : {}),
        body: artifact.body,
      })),
      3,
    );
  };
  log.info("plan start", { phases: model.phases.length, integrationBranch, base: defaultBranch });

  // plan 产物（write 直接落 in-progress 合法；后续只走 in-progress→verified/rolled-back 合法转移）。
  await d.store.write({
    kind: "plan", id: planId, status: "in-progress",
    body: model.phases.map((p) => `## ${p.title}\n${p.flows.map((f) => `- ${f.id}: ${f.title}`).join("\n")}`).join("\n\n"),
    meta: {
      phases: model.phases.length,
      flows: model.phases.reduce((a, p) => a + p.flows.length, 0),
      ...(d.planRef ? { planRef: d.planRef } : {}),
    },
  });

  // 集成分支 = default 分支起点（不碰 main）。
  await g.raw(["branch", integrationBranch, defaultBranch]);

  const flowResults: PlanFlowResult[] = [];
  const N = d.concurrency ?? 3;
  const mirror = d.mirror ?? noopMirror();

  for (let phase = 0; phase < model.phases.length; phase++) {
    // ADR-0009 打断检查点：段入口先看本实例有没有被喊停，命中则优雅停在本段前（已跑完的段保留在集成分支）。
    if (d.onCheckpoint && (await d.onCheckpoint())) {
      log.warn("plan halted by stop signal", { phase });
      return { planId, status: "stopped", integrationBranch, flows: flowResults, stoppedAtPhase: phase };
    }
    const runBudget = resolveRunBudget(process.env);
    if (runBudget.maxTokens !== undefined || runBudget.maxUsd !== undefined) {
      let spentTokens = 0;
      const flowStates: FlowState[] = [];
      for (const fr of flowResults) {
        const st = await d.tracker.read(fr.flowId);
        spentTokens += st?.tokensUsed ?? 0;
        if (st) flowStates.push(st);
      }
      const spentUsd = sumFlowUsd(flowStates);
      if (budgetHalt(spentTokens, spentUsd, runBudget).halt) {
        log.warn("plan halted by budget", { phase, spentTokens });
        emit({ type: "done", planId, status: "stopped" });
        return { planId, status: "stopped", integrationBranch, flows: flowResults, stoppedAtPhase: phase };
      }
    }
    const base = phase === 0 ? defaultBranch : integrationBranch;
    const flows = model.phases[phase].flows;
    log.info("phase start", { phase, flows: flows.length, base });
    emit({ type: "phase", planId, phase: model.phases[phase].title, index: phase, total: model.phases.length });

    // 段内并行单写者。
    const results = await runPool(flows, N, async (flow): Promise<PlanFlowResult> => {
      const dc = new DevCycle({
        harnessStamp: () => computeHarnessStamp(defaultOrchestratorRoot()),
        goalId: d.goalId,
        store: d.store, ws: d.ws, runner: d.runner, flowId: flow.id, tracker: d.tracker,
        checks: d.checks, projectRules: d.projectRules,
        budgetCheck: d.budgetCheck, acquireSlot: d.acquireSlot,
        requireScope: d.requireScope,
        redFirst: d.redFirst,
        acceptanceCmd: flow.acceptanceCmd, base, planContext: { planId, phase }, logger: d.logger,
        logPath: d.logPath, onEvent: d.onEvent, maxRepairAttempts: 2, checkpointStages: true,
        onCheckpoint: async () => isPauseRequested(d.repoRoot, flow.id),
        scopeAllow,
        memoryRecall,
        switchboard: fileSwitchboardSender(),
      });
      try {
        await mirror.onStart(flow.id, flow.title ?? flow.id);
      } catch {
        // 外部注入的镜像也必须保持旁路，不能阻断 DevCycle。
      }
      const out = await dc.run(flow.requirement);
      try {
        await mirror.onEnd(flow.id, out.status === "verified");
      } catch {
        // 镜像终态写入失败不能伪造或改变 flow 终态。
      }
      return { flowId: flow.id, phase, status: out.status };
    });
    flowResults.push(...results);

    // 失败即停段：不启动后续段（fail-closed）。
    if (results.some((r) => r.status !== "verified")) {
      log.warn("phase failed — stopping plan", { phase, failed: results.filter((r) => r.status !== "verified").map((r) => r.flowId) });
      await d.store.transition(planId, "rolled-back").catch((err) => {
        console.warn(`plan ${planId} 标记 rolled-back 失败: ${String(err)}`);
      });
      emit({ type: "done", planId, status: "stopped" });
      return { planId, status: "stopped", integrationBranch, flows: flowResults, stoppedAtPhase: phase };
    }

    // 段内全 verified → 顺序集成进 plan 分支（safeMerge 串行，避免并发抢 merge-tmp）。
    for (const flow of flows) {
      const m = await safeMerge(d.repoRoot, integrationBranch, `kp/${flow.id}`);
      if (!m.ok) {
        log.error("integration conflict — stopping plan", { phase, flowId: flow.id, error: m.error });
        await d.store.transition(planId, "rolled-back").catch(() => {});
        emit({ type: "done", planId, status: "stopped" });
        return { planId, status: "stopped", integrationBranch, flows: flowResults, stoppedAtPhase: phase };
      }
    }
    log.info("phase integrated", { phase, into: integrationBranch });
  }

  // 集成检查门：挂合并主干门前，在集成分支跑项目 checks（差分），拦跨流类型不一致等「集成才爆」的错。
  const gate = await integrationCheckGate(d.ws, d.repoRoot, integrationBranch, defaultBranch, d.checks ?? [], planId.slice(5), d.tracker.stateDir, log);
  if (!gate.ok) {
    log.error("integration check gate failed — stopping plan (集成检查门)", { newErrors: gate.newErrors.slice(0, 15) });
    await d.store.transition(planId, "rolled-back").catch(() => {});
    emit({ type: "done", planId, status: "stopped" });
    return { planId, status: "stopped", integrationBranch, flows: flowResults, integrationErrors: gate.newErrors };
  }
  log.info("integration check gate passed", { checks: (d.checks ?? []).length });

  if (d.planRef) {
    let specText: string | undefined;
    try {
      specText = await readFile(d.planRef, "utf8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn("plan-scope gate skipped: spec unreadable", { planRef: d.planRef, error: message });
      recordGateObservation(d.repoRoot, { gate: "plan-scope", flowId: planId, wouldBlock: false, reason: `spec-unreadable: ${d.planRef}`, at: Date.now(), mode: gateModeFor("plan-scope", d.repoRoot) });
    }
    if (specText !== undefined) {
      const mode = gateModeFor("plan-scope", d.repoRoot);
      try {
        const changedRaw = await simpleGit(d.repoRoot).raw([
          "diff",
          "--no-renames",
          "--name-only",
          defaultBranch + "..." + integrationBranch,
        ]);
        const changed = changedRaw.split(/\r?\n/).filter((entry) => entry.length > 0);
        const violations = planScopeViolations(specText, changed);
        console.log(`[plan-scope] 比对 ${changed.length} 个改动文件 · 越界 ${violations.length}`);
        log.info("plan-scope gate evaluated", { changed: changed.length, violations: violations.length });
        if (violations.length > 0) {
          const reason = violations.map((v) => `${v.file}（${v.rule}）`).join(", ");
          recordGateObservation(d.repoRoot, { gate: "plan-scope", flowId: planId, wouldBlock: true, reason, at: Date.now(), mode });
          if (mode === "observe") {
            log.warn(formatObserveWarn("plan-scope", reason), { violations });
          } else {
            const integrationErrors = violations.map((v) => `范围越界: ${v.file} (${v.rule})`);
            log.error("scope gate failed — stopping plan (范围门)", { violations });
            await d.store.transition(planId, "rolled-back").catch(() => {});
            emit({ type: "done", planId, status: "stopped" });
            return { planId, status: "stopped", integrationBranch, flows: flowResults, integrationErrors };
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("plan-scope gate error — stopping plan", { error: message });
        try {
          recordGateObservation(d.repoRoot, { gate: "plan-scope", flowId: planId, wouldBlock: true, reason: `gate-error: ${message}`, at: Date.now(), mode });
        } catch (observationError) {
          log.warn("plan-scope gate error observation failed", { error: observationError instanceof Error ? observationError.message : String(observationError) });
        }
        if (mode === "observe") {
          log.warn(formatObserveWarn("plan-scope", `gate-error: ${message}`));
        } else {
          await d.store.transition(planId, "rolled-back").catch(() => {});
          emit({ type: "done", planId, status: "stopped" });
          return { planId, status: "stopped", integrationBranch, flows: flowResults, integrationErrors: [`范围门执行失败: ${message}`] };
        }
      }
    }
  }

  // 全段通过 → 终点单门：把整条集成分支挂「合并主干」人工门交人（绝不自动合 main，C5）。
  await d.tracker.start(planId, `方案集成 ${planId}`, { goalId: d.goalId });
  const humanGate = { gate: "合并主干 (人工门#1)", what: `${integrationBranch} → ${defaultBranch}` };
  await d.tracker.finish(planId, "verified", humanGate);
  await d.store.transition(planId, "verified").catch(() => {});
  emit({ type: "gate", planId, what: humanGate.gate, detail: humanGate.what });
  // 自动门（env KUNPENG_AUTO_MERGE=1）：verified 后立即尝试合并主干，关掉 verify→merge 的陈旧窗口（4 门攒堆根因）。
  // 安全由 mergeAndClearGate 内的 review + 刷新闸 + CAS 保证；失败（冲突/陈旧）→ 保留人工门，交 autopilot/人重试。
  // 缺省关：env 未设时完全照旧（挂门、不自动合），测试与同伴行为不变。
  if (process.env.KUNPENG_AUTO_MERGE === "1") {
    let auto: { ok: boolean; error?: string };
    try {
      const hits: SensitiveHit[] = await (d.sensitiveHits ?? sensitiveHitsForBranch)(d.repoRoot, planId, defaultBranch);
      if (hits.length > 0) {
        await d.tracker.markSensitive(planId, hits);
        const labels = summarizeSensitiveLabels(hits);
        log.warn(`[plan] 敏感路径改动，自动合并改为人工门：${labels}`, { planId, hits });
        auto = { ok: false, error: `${SENSITIVE_GATE_NOTE}：${labels}` };
      } else {
        auto = await (d.mergeAndClearGate ?? mergeAndClearGate)(d.repoRoot, planId, defaultBranch);
      }
    } catch (e) {
      auto = { ok: false, error: String(e) };
    }
    if (auto.ok) log.info("自动门：已自动合并主干", { planId });
    else log.info("自动门：未自动合，保留人工门", { planId, reason: auto.error });
  }
  log.info("plan verified — awaiting merge gate", { integrationBranch, flows: flowResults.length });
  emit({ type: "done", planId, status: "verified" });
  return { planId, status: "verified", integrationBranch, flows: flowResults };
}
