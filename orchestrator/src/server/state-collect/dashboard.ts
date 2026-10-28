import { join } from "node:path";
import { resolveKunpengHome } from "../../util/kunpeng-home.js";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { ArtifactStore } from "../../artifacts/store.js";
import { checkAccountEnvHealth, expandEnv, loadAccounts as loadModelAccounts } from "../../agent/account-pool.js";
import { loadBackendConfig } from "../../agent/backend-config.js";
import { backendHealthPath, effectiveChain, loadBackendHealth } from "../../agent/backend-health.js";
import { loadQuota, type QuotaTracker } from "../../agent/quota-tracker.js";
import { ReinjectStore } from "../../feedback/reinject-store.js";
import { GoalStore, goalsDir } from "../../goals/store.js";
import { LoopLearningStore } from "../../loop/learnings.js";
import { listOpsGates, type OpsGateEntry } from "../../loop/ops-gate.js";
import { listPlaybooks, type PlaybookDef } from "../../loop/playbook.js";
import { summarizeLoop } from "../../loop/summary.js";
import { LoopStore } from "../../loop/store.js";
import type { LoopDef } from "../../loop/types.js";
import { checkGateConservation, computeAutoCompletion, computeTokenTrend } from "../../metrics/metrics.js";
import { rolledBackFlowIdsFromStates } from "../../metrics/escape-rate-report.js";
import { clusterFailures } from "../../metrics/failure-signature.js";
import { readRecentFailureItems, readWeeklyFlows } from "../../metrics/flow-failures.js";
import { buildRollbackHeatmap } from "../../metrics/rollback-heatmap.js";
import { aggregateSavings } from "../../metrics/time-saved.js";
import { aggregateStageDurations, buildStageBottlenecks } from "../../perf/stage-duration.js";
import { readDesignConfig } from "../../project/design-config.js";
import { readRegistry, kunpengStateDir } from "../../project/registry.js";
import { resolveProjectStateDir } from "../../project/state-resolve.js";
import { sweepStalePreviews } from "../../product/preview.js";
import type { ProductEntry } from "../../product/registry.js";
import { listProductsView } from "../../product/registry-service.js";
import { summarizeCost, type StageCost } from "../../runtime/cost-metrics.js";
import { FlowTracker } from "../../runtime/flowstate.js";
import type { FlowState } from "../../runtime/flowstate.js";
import { buildStatusContext } from "../../status/build-context.js";
import { collectModuleStatus } from "../../status/collect-module-status.js";
import { collectPreflight, type PreflightItem } from "../../status/preflight.js";
import { PresenceStore, isOnline } from "../../switchboard/presence.js";
import { relTime } from "../../util/rel-time.js";
import { assessFlowHealth } from "../../watchdog/health.js";
import type { PreReview } from "../pre-review.js";
import { cachedAsync, type CacheEntry } from "../state-cache.js";
import { aggregateTokensByBackend, aggregateTokensByModel, withSnapshotStateDir } from "../state-cost-aggregates.js";
import { aggregateStageTokens, buildF07Dashboard, slimArtifactsForDashboard, slimFlowsForDashboard, slimPlansForDashboard } from "../state-dashboard-slim.js";
import { readDesignCandidates, readDesignVerdict, readProductSessionView } from "../state-projections.js";
import { htmlReportTitle, markdownReportTitle } from "../state-title-helpers.js";
import type {
  AgentPresent,
  DashboardState,
  GoalView,
  LoopView,
  OpsReport,
  ProjectSnapshot,
  QualityGateStats,
  StateItem,
} from "../state-types.js";
import { collectEvolutionTruth } from "./evolution.js";
import { collectFlowTruth } from "./flows.js";
import { collectPlansCode } from "./plans-code.js";

const LLM_STAGES = new Set(["spec", "design", "implement", "review", "repair"]);

export function stageIsLlm(stage: string): boolean {
  return LLM_STAGES.has(stage);
}

export function flowsToStageCosts(
  flows: { history?: { stage: string; at: number }[] }[],
): StageCost[] {
  return flows.flatMap((flow) =>
    (flow.history ?? []).map(({ stage }) => ({
      stage,
      llm: stageIsLlm(stage),
    })),
  );
}

/** 闲置预览回收节流：状态聚合高频刷新，GC 最多每仓库 60s fire-and-forget 一次。 */
const previewSweepCache = new Map<string, number>();
const PREVIEW_SWEEP_TTL_MS = 60_000;

function triggerStalePreviewSweep(repoRoot: string, now: number): void {
  const last = previewSweepCache.get(repoRoot);
  if (last !== undefined && now - last < PREVIEW_SWEEP_TTL_MS) return;
  previewSweepCache.set(repoRoot, now);
  void sweepStalePreviews(repoRoot).catch(() => {});
}

/** 加载 accounts.json（格式：[{ id, limit?, windowHours? }, ...]）。缺失/坏档返回空。home=KUNPENG_HOME。 */
async function loadAccounts(home: string): Promise<{ id: string; limit?: number; windowHours?: number }[]> {
  try {
    const raw = await readFile(join(home, ".kunpeng", "accounts.json"), "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

/** 聚合 quota 数据：按账号汇总已用（窗内）、限额、重置时间、per-model 明细。home=KUNPENG_HOME。 */
async function aggregateQuota(
  home: string,
  tracker: QuotaTracker,
  now: number
): Promise<{ accounts: { id: string; used: number; limit?: number; resetMs?: number; models: { model: string; calls: number }[]; health?: { ok: boolean; reason?: string } }[]; total: number } | undefined> {
  const accounts = await loadAccounts(home);
  if (!accounts.length) return undefined;

  // 把账号级窗口配置接进 tracker——loadQuota 出来的 tracker 不带 windowHours，
  // 不接的话 accountTotal/windowResetMs 退化成终身累计（D1）。
  tracker.applyAccountConfig(accounts);

  const usage = tracker.usage();
  const result: { id: string; used: number; limit?: number; resetMs?: number; models: { model: string; calls: number }[]; health?: { ok: boolean; reason?: string } }[] = [];

  let total = 0;
  for (const acct of accounts) {
    const used = tracker.accountTotal(acct.id, now); // 窗内已用（过窗归零），非终身 usage 之和
    total += used;
    const resetMs = tracker.windowResetMs(acct.id, now);
    // 过窗账号（used=0）的 per-model 明细一并隐去，避免显示 stale 计数
    const models = used > 0 ? usage.filter((u) => u.account === acct.id).map((u) => ({ model: u.model, calls: u.calls })) : [];

    result.push({
      id: acct.id,
      used,
      ...(acct.limit !== undefined && { limit: acct.limit }),
      ...(resetMs !== undefined && { resetMs }),
      models,
    });
  }

  return { accounts: result, total };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function artifactCounts(artifacts: Record<string, StateItem[]>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(artifacts).map(([kind, items]) => [kind, items.length])
  );
}

const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;
const QUALITY_GATE_FAILED_STATUSES = new Set(["failed", "rolled-back", "crashed", "stopped"]);

async function collectQualityGateStats(
  stateDir: string,
  now: number,
  flowStates: FlowState[] | undefined,
): Promise<QualityGateStats> {
  const [weeklyResult, failuresResult] = await Promise.allSettled([
    readWeeklyFlows(stateDir),
    readRecentFailureItems(stateDir, 7, now),
  ]);

  let verified30d: QualityGateStats["verified30d"] = { status: "error" };
  if (weeklyResult.status === "fulfilled") {
    const cutoff = now - THIRTY_DAYS_MS;
    const recent = weeklyResult.value.filter((flow) => flow.at >= cutoff && flow.at <= now);
    const verified = recent.filter((flow) => flow.status === "verified").length;
    const failed = recent.filter((flow) => QUALITY_GATE_FAILED_STATUSES.has(flow.status)).length;
    verified30d = { status: "ok", verified, total: verified + failed };
  }

  let failures7d: QualityGateStats["failures7d"] = { status: "error" };
  if (failuresResult.status === "fulfilled") {
    failures7d = {
      status: "ok",
      count: failuresResult.value.length,
      patterns: clusterFailures(failuresResult.value).map(({ signature, count }) => ({ signature, count })),
    };
  }

  let rolledBackTotal: QualityGateStats["rolledBackTotal"] = { status: "error" };
  if (flowStates !== undefined) {
    try {
      rolledBackTotal = {
        status: "ok",
        count: rolledBackFlowIdsFromStates(flowStates.map(({ flowId, status }) => ({ flowId, status }))).length,
      };
    } catch {
      // 聚合异常只降级该指标，不能拖垮 Insights 页。
    }
  }

  return { verified30d, failures7d, rolledBackTotal };
}

export async function collectGoals(repoRoot: string): Promise<GoalView[]> {
  try {
    const goals = await new GoalStore(goalsDir(join(repoRoot, ".kunpeng"))).list();
    return goals.map(({ id, owner, statement, status }) => ({ id, owner, statement, status }));
  } catch {
    return [];
  }
}

export function loopViewFrom(loop: LoopDef, now: number): LoopView {
  const waves = [...loop.waves].sort((a, b) => b.seq - a.seq);
  const gotchas: string[] = [];
  const seenGotchas = new Set<string>();
  for (const wave of waves.slice(0, 10)) {
    for (const gotcha of wave.gotchas ?? []) {
      const text = gotcha.trim();
      if (text && !seenGotchas.has(text)) {
        seenGotchas.add(text);
        gotchas.push(text);
      }
    }
  }

  const active = loop.levers.filter((lever) => lever.status === "active");
  const needsDev = loop.levers.filter((lever) => lever.status === "needs-dev");
  const honestZero = loop.levers.filter((lever) => lever.status === "honest-zero");
  const nextLever = loop.nextLever
    ? loop.levers.find((lever) => lever.id === loop.nextLever?.lever)
    : undefined;

  return {
    id: loop.id,
    projectId: loop.projectId,
    name: loop.name,
    metric: { label: loop.metric.label, current: loop.metric.current },
    waveCount: loop.waves.length,
    waves: waves.slice(0, 1).map((wave) => ({
      seq: wave.seq,
      at: wave.at,
      lever: wave.lever,
      subject: wave.subject,
      metricDelta: wave.metricDelta,
      metricAfter: wave.metricAfter,
      ...(wave.deploy !== undefined && { deploy: wave.deploy }),
      verified: wave.verified,
      ...(wave.evidenceKind !== undefined && { evidenceKind: wave.evidenceKind }),
      ...(wave.gotchas !== undefined && { gotchas: wave.gotchas }),
    })),
    recent: waves.slice(0, 5).map((wave) => ({
      seq: wave.seq,
      lever: wave.lever,
      subject: wave.subject,
      metricDelta: wave.metricDelta,
      metricAfter: wave.metricAfter,
      ...(wave.deploy !== undefined && { deploy: wave.deploy }),
      verified: wave.verified,
      ...(wave.evidenceKind !== undefined && { evidenceKind: wave.evidenceKind }),
      agoText: relTime(now - wave.at),
    })),
    leversByStatus: { active, needsDev, honestZero },
    ...(nextLever !== undefined && { nextLever }),
    gotchas,
    summary: summarizeLoop(loop),
    ...(loop.goalId ? { goalId: loop.goalId } : {}),
  };
}

async function collectLoops(repoRoot: string, now: number): Promise<LoopView[]> {
  try {
    const store = new LoopStore(join(repoRoot, ".kunpeng", "loops"));
    const learningStore = new LoopLearningStore(join(repoRoot, ".kunpeng", "loops"));
    const loops = await store.list();
    return Promise.all(loops.map(async (loop) => ({
      ...loopViewFrom(loop, now),
      learnings: await learningStore.recent(loop.id, 8),
    })));
  } catch {
    return [];
  }
}

async function collectPlaybooks(repoRoot: string): Promise<PlaybookDef[]> {
  try {
    return await listPlaybooks(repoRoot);
  } catch {
    return [];
  }
}

async function collectOpsGates(repoRoot: string): Promise<OpsGateEntry[] | undefined> {
  try {
    return (await listOpsGates(repoRoot)).filter((gate) => gate.status === "pending");
  } catch {
    return undefined;
  }
}

export async function listOpsReports(repoRoot: string): Promise<OpsReport[]> {
  const reports: OpsReport[] = [];

  async function collectDir(dir: string, kind: OpsReport["kind"]): Promise<void> {
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return;
    }

    const ext = kind === "html" ? ".html" : ".md";
    for (const file of files.filter((name) => name.endsWith(ext))) {
      try {
        const path = join(dir, file);
        const [raw, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
        reports.push({
          file,
          kind,
          title: kind === "html" ? htmlReportTitle(raw, file) : markdownReportTitle(raw, file),
          mtime: info.mtimeMs,
        });
      } catch {
        // 单个坏文件不能拖垮运营页。
      }
    }
  }

  await collectDir(join(repoRoot, ".kunpeng", "previews"), "html");
  await collectDir(join(repoRoot, "docs", "reports"), "md");

  return reports.sort((a, b) => b.mtime - a.mtime);
}

async function collectOpsReports(repoRoot: string): Promise<OpsReport[]> {
  try {
    return await listOpsReports(repoRoot);
  } catch {
    return [];
  }
}

async function collectAgentsPresent(now: number): Promise<AgentPresent[]> {
  try {
    const heartbeats = await new PresenceStore(join(kunpengStateDir(), "presence")).list();
    return heartbeats
      .filter((heartbeat) => isOnline(heartbeat.ts, now, 30 * 60_000))
      .map((heartbeat) => ({
        instance: heartbeat.instance,
        ...(heartbeat.projectId !== undefined && { projectId: heartbeat.projectId }),
        ...(heartbeat.worktree !== undefined && { worktree: heartbeat.worktree }),
        ...(heartbeat.task !== undefined && { task: heartbeat.task }),
        ts: heartbeat.ts,
      }));
  } catch {
    return [];
  }
}

const PREFLIGHT_CACHE_TTL_MS = 60_000;
let preflightCache: { at: number; items: PreflightItem[] } | undefined;

async function collectPreflightCached(now: number): Promise<PreflightItem[] | undefined> {
  if (preflightCache !== undefined && now - preflightCache.at < PREFLIGHT_CACHE_TTL_MS) {
    return preflightCache.items;
  }

  try {
    const items = await collectPreflight();
    preflightCache = { at: now, items };
    return items;
  } catch {
    return undefined;
  }
}

export async function collectState(store: ArtifactStore, repoRoot: string, opts?: { kunpengHome?: string }): Promise<DashboardState> {
  const now = Date.now();
  triggerStalePreviewSweep(repoRoot, now);
  const arts = await store.listSummaries();
  const artifacts: Record<string, StateItem[]> = {};
  const statusCounts: Record<string, number> = {};
  for (const a of arts) {
    const summary = a.summary;
    (artifacts[a.kind] ??= []).push({
      id: a.id,
      kind: a.kind,
      status: a.status,
      summary,
      preReview: (a.meta as { preReview?: PreReview } | undefined)?.preReview,
    });
    statusCounts[a.status] = (statusCounts[a.status] ?? 0) + 1;
  }

  // Flow state tracking
  const flowStateDir = resolveProjectStateDir(repoRoot);
  const tracker = new FlowTracker(flowStateDir);
  let allFlows: FlowState[];
  let flowStatesForGateStats: FlowState[] | undefined;
  try {
    allFlows = await tracker.list();
    flowStatesForGateStats = allFlows;
  } catch {
    // state 目录整体损坏时保住页面其余面板，并让质量门指标显式报读取失败。
    allFlows = [];
  }
  const qualityGateStatsPromise = collectQualityGateStats(flowStateDir, now, flowStatesForGateStats);
  let rollbackHeatmap: DashboardState["rollbackHeatmap"];
  try {
    rollbackHeatmap = buildRollbackHeatmap(allFlows, { sinceMs: now - 30 * 86_400_000 });
  } catch {
    rollbackHeatmap = undefined;
  }

  const {
    flows,
    running,
    agents,
    blockers,
    humanGates,
    systemLight: collectedSystemLight,
    agentAssignments,
    activity,
  } = collectFlowTruth({ allFlows, arts, now });
  let systemLight = collectedSystemLight;

  const { evolution, patrol } = await collectEvolutionTruth({ arts, repoRoot });
  const { branches, main, plans, code, lastMergeAt } = await collectPlansCode({ repoRoot, store, arts, flows, now });

  const designCandidates = await readDesignCandidates(repoRoot);
  const designSelected = (await readDesignConfig(repoRoot))?.source;
  const designVerdict = await readDesignVerdict(repoRoot);
  const productSession = await readProductSessionView(repoRoot);
  const productList = await listProductsView(repoRoot, Date.now()).catch(() => [] as ProductEntry[]);
  const productArchived = (await listProductsView(repoRoot, Date.now(), { includeArchived: true }).catch(() => [] as ProductEntry[]))
    .filter((product) => product.status === "archived");
  const loops = await collectLoops(repoRoot, now);
  const playbooks = await collectPlaybooks(repoRoot);
  const opsGates = await collectOpsGates(repoRoot);
  const goals = await collectGoals(repoRoot);
  const opsReports = await collectOpsReports(repoRoot);
  // P4 看门狗：评估运行中流的健康（卡死=running 但久未更新 / 长跑）。
  const health = assessFlowHealth(allFlows.map((f) => ({ flowId: f.flowId, stage: f.stage, status: f.status, startedAt: f.startedAt, updatedAt: f.updatedAt })), now);
  const autoCompletion = computeAutoCompletion(allFlows.map((f) => ({ status: f.status })));
  const f07 = buildF07Dashboard(allFlows, now);
  const savings = aggregateSavings(allFlows);
  const tokenTrend = computeTokenTrend(allFlows.map((f) => ({ status: f.status, tokensUsed: f.tokensUsed, updatedAt: f.updatedAt })));
  const gateConservation = checkGateConservation(
    allFlows.filter((f) => f.humanGate).map((f) => ({ gate: f.humanGate!.gate, what: f.humanGate!.what })),
  );
  let reinjectBacklog: { pending: number } | undefined;
  try {
    reinjectBacklog = { pending: (await new ReinjectStore(join(repoRoot, ".kunpeng", "feedback")).pending()).length };
  } catch {
    /* 无目录→留空 */
  }

  // 账号/配额是鲲鹏后台级全局资产：从 KUNPENG_HOME 读，不是目标仓库 repoRoot（D2）。
  const kunpengHome = opts?.kunpengHome ?? resolveKunpengHome();
  let quota: DashboardState["quota"];
  try {
    const quotaPath = join(kunpengHome, ".kunpeng", "quota.json");
    if (await fileExists(quotaPath)) {
      const tracker = await loadQuota(quotaPath);
      quota = await aggregateQuota(kunpengHome, tracker, now);
      if (quota) {
        try {
          const accountPath = join(kunpengHome, ".kunpeng", "accounts.json");
          const accounts = await loadModelAccounts({ home: kunpengHome, envPath: accountPath });
          const healthById = new Map(accounts.map((account) => [
            account.id,
            checkAccountEnvHealth(account.env ? expandEnv(account.env) : undefined),
          ]));
          quota = {
            ...quota,
            accounts: quota.accounts.map((account) => {
              const health = healthById.get(account.id);
              return health ? { ...account, health } : account;
            }),
          };
        } catch {
          /* 账号健康读取失败时保留已聚合的 quota，health 留空。 */
        }
      }
    }
    // 任一账号超限 → 健康灯至少提到黄（spec：不直接拉红，红留给真正的失败流/卡死）。
    if (quota && quota.accounts.some((a) => a.limit !== undefined && a.used >= a.limit)) {
      if (systemLight === "green") systemLight = "yellow";
    }
  } catch { /* quota loading failed, continue without it */ }

  const backendConfig = await loadBackendConfig(join(repoRoot, ".kunpeng", "backends.json")).catch(() => undefined);
  const backendHealthFile = loadBackendHealth(backendHealthPath(join(repoRoot, ".kunpeng")), now);
  const { order, down, modelsDown } = effectiveChain({ enabled: backendConfig?.enabled ?? ["claude", "codex"], file: backendHealthFile, now });
  const backendHealth = { chain: order, down, modelsDown };
  const agentsPresent = await collectAgentsPresent(now);
  const preflight = await collectPreflightCached(now);
  const qualityGateStats = await qualityGateStatsPromise;

  const moduleStatus = collectModuleStatus(
    await buildStatusContext({
      repoRoot,
      stateDir: kunpengStateDir(),
      now,
      truths: {
        flows: flows.map((f) => ({ status: f.status, stage: f.stage, updatedAt: f.updatedAt, blocker: f.blocker })),
        health,
        evolution,
        loops: loops?.map((l) => ({ id: l.id, name: l.name, waveCount: l.waveCount })),
        patrol,
        quota: quota ? { total: quota.total, accounts: quota.accounts.map((a) => ({ id: a.id })) } : undefined,
        branches,
        lastMergeAt,
      },
    }),
  );

  return { agents, agentsPresent, preflight, flows: slimFlowsForDashboard(flows), flowsTotal: flows.length, running, blockers, humanGates, artifacts: slimArtifactsForDashboard(artifacts), artifactsTotal: artifactCounts(artifacts), branches, statusCounts, systemLight, agentAssignments, patrol, autoCompletion, f07, savings, qualityGateStats, rollbackHeatmap, tokenTrend, gateConservation, reinjectBacklog, plans: slimPlansForDashboard(plans), plansTotal: plans.length, code, designCandidates, designSelected, designVerdict, productSession, productList, productArchived, health, main, activity, evolution, loops, playbooks, opsGates, goals, opsReports, costSummary: { ...summarizeCost(flowsToStageCosts(flows)), totalTokens: flows.reduce((sum, f) => sum + (f.tokensUsed ?? 0), 0), tokensByStage: aggregateStageTokens(flows), tokensByModel: aggregateTokensByModel(flows), tokensByBackend: aggregateTokensByBackend(flows), durationByStage: aggregateStageDurations(flows, Date.now()), stageBottlenecks: buildStageBottlenecks(
    aggregateStageDurations(flows, Date.now()),
    aggregateStageTokens(flows),
    3
  ).bottlenecks }, quota, backendConfig, backendHealth, moduleStatus };
}
/** 跨项目「在跑流」合并：把各项目的 running 流汇成一条列表，每条带 project 标注（哪个项目发起）。
 *  按 startedAt 降序（最新起的在前）。纯函数。 */

/** 全空/默认的 DashboardState，用于降级快照（某项目采集失败时）。 */
function emptyDashboardState(): DashboardState {
  return { agents: 1, agentsPresent: [], flows: [], running: [], blockers: [], humanGates: [], artifacts: {}, branches: [], statusCounts: {}, systemLight: "green", agentAssignments: [], patrol: { pendingCount: 0, lastRunText: "尚未巡检" }, plans: [], code: { srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0 }, designCandidates: [], health: { alerts: [], running: 0, healthy: 0 }, activity: { total: 0, verified: 0, rolledBack: 0, successRate: 1, recent: [] }, evolution: { lastRunText: "尚未巡检", pendingCount: 0, proposals: [], regression: { holdout: 0, optimization: 0 }, approvedCount: 0, upgrades: [] }, loops: [], quota: undefined };
}

const multiStateCache = new Map<string, CacheEntry<DashboardState>>();
const flowListCache = new Map<string, CacheEntry<FlowState[]>>();
const MULTI_STATE_TTL_MS = Number(process.env.KUNPENG_STATE_TTL_MS) || 3000;
/** 测试用:清空概览多项目缓存。 */
export function __clearStateCache(): void { multiStateCache.clear(); }

export async function collectStateCached(store: ArtifactStore, repoRoot: string): Promise<DashboardState> {
  return cachedAsync(multiStateCache, repoRoot, MULTI_STATE_TTL_MS, Date.now(), () => collectState(store, repoRoot));
}

export async function listFlowsCached(repoRoot: string, now?: number): Promise<FlowState[]> {
  return cachedAsync(
    flowListCache,
    repoRoot,
    MULTI_STATE_TTL_MS,
    now ?? Date.now(),
    () => new FlowTracker(resolveProjectStateDir(repoRoot)).list(),
  );
}

/** 读中央注册表 → 对每个项目读它自己的 .kunpeng/{artifacts,state} → 一项目一快照（流不串项目）。
 *  按项目隔离失败：单项目采集出错只产降级快照（带 error），不拖垮整盘。 */
export async function collectMultiState(stateDir: string): Promise<ProjectSnapshot[]> {
  const entries = await readRegistry(stateDir);
  return Promise.all(entries.map(async (e) => {
    try {
      const store = new ArtifactStore(join(e.repoPath, ".kunpeng", "artifacts"));
      const state = await cachedAsync(multiStateCache, e.repoPath, MULTI_STATE_TTL_MS, Date.now(), () => collectState(store, e.repoPath));
      return withSnapshotStateDir({ id: e.id, name: e.name, repoPath: e.repoPath, state }, stateDir || kunpengStateDir());
    } catch (err) {
      return withSnapshotStateDir({ id: e.id, name: e.name, repoPath: e.repoPath, state: emptyDashboardState(), error: String(err) }, stateDir || kunpengStateDir());
    }
  }));
}
