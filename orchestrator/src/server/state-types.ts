import type { FlowState } from "../runtime/flowstate.js";
import type { RollbackHeatmap } from "../metrics/rollback-heatmap.js";
import type { ProductDefinition } from "../product/contract.js";
import type { LoopView as ProductLoopView } from "../product/loop-orchestrate.js";
import type { PreReview } from "./pre-review.js";
import type { InboxTriage } from "./inbox-triage.js";
import type { InboxPolicy } from "./inbox-policy.js";
import type { AutoCompletion, TokenTrend, GateConservation } from "../metrics/metrics.js";
import type { SavingsRollup } from "../metrics/time-saved.js";
import type { CostSummary } from "../runtime/cost-metrics.js";
import type { HealthReport } from "../watchdog/health.js";
import type { ChannelSummary } from "./evolution-channels.js";
import type { ActionLevel, Lever, Wave } from "../loop/types.js";
import type { LoopInsight } from "../loop/summary.js";
import type { PlaybookDef } from "../loop/playbook.js";
import type { OpsGateEntry } from "../loop/ops-gate.js";
import type { ProductEntry } from "../product/registry.js";
import type { ProductActivityEvent } from "../product/activity-log.js";
import type { CheckpointMeta } from "../product/loop-checkpoint.js";
import type { DossierOverview } from "./dossier-state.js";
import type { EventLoopLag } from "./event-loop-monitor.js";
import type { PerfSample } from "../perf/perf-sample.js";
import type { BackendConfig } from "../agent/backend-config.js";
import type { ModuleStatusReport } from "../status/types.js";
import type { PreflightItem } from "../status/preflight.js";

/** 一套已渲染的设计候选（供总控台展示 + 点选）。 */
export interface DesignCandidatePreview { index: number; source: string; anchor: string; png: string }

export interface DesignVerdictView {
  tier1AutoPass: boolean;
  needsHumanReview: boolean;
  blockers: string[];
  a11yGateable: boolean;
  perfWithinBudget: boolean;
  visualMatchesBaseline: boolean;
  hasNewOrChangedBaseline: boolean;
}

export interface ProductSessionView {
  status: "in-progress" | "done";
  idea: string;
  answeredCount: number;
  totalQuestions: number;
  currentQuestion?: string;
  definition?: ProductDefinition;
  loop?: ProductLoopView;     // 阶段机 + spec + brief（有产品定义后才有）
}

export interface OpsReport {
  file: string;
  kind: "html" | "md";
  title: string;
  projectId?: string;
  mtime: number;
}

// 用每阶段真实 backend + stage->tier 路由表把每阶段 token 归到模型。
// claude->tier.model(完整 model-id，如 claude-sonnet-4-6/claude-opus-4-8)；codex->tier.effort(low/high)。标签与 quota 一致(裸 tier)。
export interface ChatCostRollup {
  totalTokens: number;
  tokensByModel: Record<string, number>;
}

export interface StateItem {
  id: string;
  kind: string;
  status: string;
  summary: string;
  preReview?: PreReview;
}

export interface ReviewDecision {
  action: string;
  params?: Record<string, unknown>;
  evidence?: string;
  reasoning?: string;
  costUsd?: number;
  blastRadius?: ActionLevel;
  expiresAt?: number;
  expired?: boolean;
  heldByCap?: boolean;
  absent?: boolean;
  owner?: string;
}

export interface ReviewItem {
  projectId: string;
  projectName: string;
  kind: "merge" | "proposal" | "release" | "connector" | "ops-gate" | "failed" | "blocked" | "alert" | "budget";
  id: string;
  title: string;
  detail: string;
  preReview?: PreReview;
  decision?: ReviewDecision;
  /** 为什么到你这里 + 机器的把握（审计 P1-10）；聚合末尾统一算，视图按它分三栏。 */
  triage?: InboxTriage;
}

/** 一条方案的进度摘要（id/状态/是否已合入 main/一句话描述/正文摘要/段数）。 */
export interface PlanSummary { id: string; status: string; merged: boolean; desc: string; summary: string; segmentCount: number }

/** 代码与方案的整体计数。 */
export interface CodeMetrics {
  srcLines: number;        // orchestrator/src 行数
  testLines: number;       // orchestrator/test 行数
  passedLines: number;     // 已合入 main（过审）的鲲鹏代码行数 = src+test
  inFlightLines: number;   // 运行中方案分支里、尚未合入 main 的新增行
  completed: number;       // 已合并完成的方案数
  running: number;         // 进行中方案数
  rolledBack: number;      // 已回滚方案数
}

export interface FlowWithLight extends FlowState {
  light: "red" | "green";
  etaRemainingMs?: number;
  elapsedMs?: number;       // 运行中流的已耗时——比脆弱的 ETA 倒计时更稳的「在跑」信号（#8）
  project?: { id: string; name: string };  // 跨项目总览时标注该流属于哪个项目（单项目视图不填）
}

export interface MainTruth {
  commit: string;
  subject: string;
  committedText: string;
  mergedPlans: number;
  staleBranches: number;
}

export interface ActivityTruth {
  total: number;
  verified: number;
  rolledBack: number;
  successRate: number;
  recent: { flowId: string; status: string; stage: string; updatedAt: number; agoText: string; project?: { id: string; name: string } }[];
}

export interface ProjectActivity {
  id: string;
  name: string;
  total: number;
  verified: number;
  rolledBack: number;
  successRate: number;
  recent: { flowId: string; status: string; stage: string; updatedAt: number; agoText: string }[];
}

export interface ProjectCostSummary {
  id: string;
  name: string;
  totalTokens: number;
  llmStages: number;
  totalStages: number;
  deterministicStages: number;
  determinismRatio: number;
  savedLlmCalls: number;
  tokensByStage: Record<string, number>;
  tokensByModel?: Record<string, number>;
  tokensByBackend?: Record<string, number>;
}

export interface F07Dashboard {
  autoCompletionPct: number;
  rollbackPct: number;
  openHumanGates: number;
  tokens30d: number;
  tokensPrev30d: number;
  costTrend: "down" | "up" | "flat";
}

export interface EvolutionProposalView {
  id: string;
  status: string;
  summary: string;
  hasEvidence: boolean;
  channel?: string;
  evidenceState?: string;
  score?: number;
  sources?: string[];
  holdoutPassK?: number;
  baselinePassK?: number;
  delta?: number;
  costPerResolvedTask?: number;
}

export interface EvolutionDashboard {
  holdoutPassAt1?: number;
  lastDelta?: number;
  archiveSize: number;
  approvedCount: number;
  holdoutCount: number;
  optimizationCount: number;
  holdoutEpoch?: number;
  series: { id: string; pass: number; delta: number }[];
}

export interface EvolutionUpgrade {
  id: string;
  summary: string;
  changes: { target: string; text: string }[];
  holdoutPassK?: number;
  delta?: number;
}

export interface EvolutionTruth {
  lastRunText: string;
  pendingCount: number;
  proposals: EvolutionProposalView[];
  regression: { holdout: number; optimization: number };
  approvedCount: number;
  upgrades: EvolutionUpgrade[];
  channels?: ChannelSummary[];
  dashboard?: EvolutionDashboard;
}

type DashboardEvolutionTruth = EvolutionTruth | (Omit<EvolutionTruth, "upgrades"> & { upgrades?: undefined });

export interface LoopView {
  projectId?: string;
  goalId?: string;
  id: string;
  name: string;
  summary: LoopInsight;
  learnings?: import("../loop/learnings.js").Learning[];
  metric: { label: string; current: string | number };
  waveCount: number;
  recent: {
    seq: number;
    lever: string;
    subject: string;
    metricDelta: string | number;
    metricAfter: string | number;
    deploy?: string;
    verified: boolean;
    evidenceKind?: string;
    agoText: string;
  }[];
  waves?: Pick<Wave, "seq" | "at" | "lever" | "subject" | "metricDelta" | "metricAfter" | "deploy" | "verified" | "evidenceKind" | "gotchas">[];
  leversByStatus: {
    active: Lever[];
    needsDev: Lever[];
    honestZero: Lever[];
  };
  nextLever?: Lever;
  gotchas: string[];
}

export interface AgentPresent {
  instance: string;
  projectId?: string;
  worktree?: string;
  task?: string;
  ts: number;
}

export interface SkillCatalogSource {
  id: string;
  name: string;
  description: string;
  origin: string;
  layer?: string;
  tags?: string[];
  enabled?: boolean;
  category?: string;
}

export interface SkillOverviewEntry extends SkillCatalogSource {
  usedBy: Array<{ projectId?: string; playbookId: string }>;
}

export interface SolutionOverviewEntry {
  id: string;
  name: string;
  description: string;
  playbookCount: number;
}

export interface DocEntry { name: string; title: string; updatedAt: number }

export interface QualityGateStats {
  verified30d:
    | { status: "ok"; verified: number; total: number }
    | { status: "error" };
  failures7d:
    | { status: "ok"; count: number; patterns: Array<{ signature: string; count: number }> }
    | { status: "error" };
  rolledBackTotal:
    | { status: "ok"; count: number }
    | { status: "error" };
}

export interface DashboardFlowState {
  agents: number;
  agentsPresent?: AgentPresent[];
  self?: {
    srcLines: number;
    testLines: number;
    passedLines: number;
    completed: number;
    flowsTotal: number;
    plansTotal: number;
  };
  flows: FlowWithLight[];
  flowsTotal?: number;
  running: FlowWithLight[];
  blockers: { flowId: string; stage: string; reason: string }[];
  humanGates: { what: string; detail: string; flowId: string; preReview?: PreReview }[];
  artifacts: Record<string, StateItem[]>;
  artifactsTotal?: Record<string, number>;
  branches: string[];
  statusCounts: Record<string, number>;
  systemLight: "red" | "yellow" | "green";
  agentAssignments: { agent: string; doing: string; backend?: string; fellBack?: boolean }[];
  plans: PlanSummary[];   // 每个方案的进度（运行中/待合并/已合并/回滚）
  plansTotal?: number;
  code: CodeMetrics;      // 整体计数：代码行数 + 过审行数 + 方案完成数
}

export interface DashboardQualityState {
  patrol: { pendingCount: number; lastRunText: string };  // P2c 巡检摘要：待审提案数 + 上次巡检
  autoCompletion?: AutoCompletion;     // F-07①无人工介入达可交付率(对 80% 目标)
  f07?: F07Dashboard;                   // F-07 总览五指标仪表
  tokenTrend?: TokenTrend;             // F-07⑤每需求 token 趋势(降=好)
  gateConservation?: GateConservation; // F-07②人工门只有3类的守恒检查
  reinjectBacklog?: { pending: number }; // 飞轮:守护发现回灌待办数
  health: HealthReport;                        // P4 看门狗：卡死/长跑流告警
  eventLoopLag?: EventLoopLag;                    // Node event loop lag（仅 collectOverviewState 填充）
  /** 质量门战绩：近 30 天 verified 率、近 7 天失败模式与历史回滚数。 */
  qualityGateStats?: QualityGateStats;
  /** 全系统各模块运行状态总览（健康灯+最近活动+心跳），供 overview 模块面板渲染。 */
  moduleStatus?: ModuleStatusReport;
  preflight?: PreflightItem[];
}

export interface DashboardDesignState {
  designCandidates: DesignCandidatePreview[];  // 已渲染的设计候选（P7b 真渲染）
  designSelected?: string;                     // 已选定的设计来源（project.json design.source）
  /** 选定设计经 design-codegen 出门的 tier 裁决，供设计 tab 渲染。 */
  designVerdict?: DesignVerdictView;
}

export interface DashboardProductState {
  /** 产品轨 DEFINE 访谈的当前 session 视图，供产品 tab 渲染。 */
  productSession?: ProductSessionView;
  /** 产品轨产品列表（注册表，active），供 hub 视图渲染。 */
  productList?: ProductEntry[];
  /** 产品轨归档产品列表，供 hub 恢复入口使用。 */
  productArchived?: ProductEntry[];
  /** 用户是否主动选中了某产品（?product=）。未选中时产品 tab 只显示 hub + 空态，不渲染工位。 */
  productSelected?: boolean;
  /** 选中产品的活动流（倒序），供工位渲染。 */
  productActivity?: ProductActivityEvent[];
  /** 选中产品的历史检查点（倒序）。 */
  productCheckpoints?: CheckpointMeta[];
  productOpsSummary?: {
    pageviews: number;
    errors: number;
    topEvents: Array<{ name: string; count: number }>;
    sinceMs: number;
    feedback?: { count: number; avgScore: number; recent: Array<{ score: number; comment?: string; at: number }> };
  };
}

export interface GoalView {
  id: string;
  owner: string;
  statement: string;
  status: string;
}

export interface DashboardOperationsState {
  dossier?: DossierOverview;
  main?: MainTruth;                             // 主干 main 的当前状态（非 git 仓库时为空）
  activity?: ActivityTruth;                     // 研发活动史（流维度）
  activityByProject?: ProjectActivity[];        // 研发活动史（项目分组）
  evolution?: DashboardEvolutionTruth;          // 自进化只读聚合事实
  loops?: LoopView[];                            // 运营 loop 只读聚合事实
  playbooks?: PlaybookDef[];                      // 运营 playbook 只读聚合事实
  opsGates?: OpsGateEntry[];                       // 运营人工门只读聚合事实
  goals?: GoalView[];
  opsReports?: OpsReport[];                       // 运营页调研档案只读聚合事实
  reviewQueue?: ReviewItem[];                    // 跨项目人审队列（仅 collectOverviewState 填充）
  inboxPolicy?: InboxPolicy;
  seenInboxKeys?: string[];                      // 已展示过的收件箱条目 key（kind:id）
}

export interface DashboardCatalogState {
  solutions?: {
    templates: Array<{ id: string; name: string; description?: string; playbookCount: number; loopCount: number; installed: string[] }>;
    projects: Array<{ id: string; name: string }>;
  };
  skillCatalog?: SkillOverviewEntry[];
  solutionCatalog?: SolutionOverviewEntry[];
  docsCatalog?: DocEntry[];
}

export interface DashboardCostState {
  costByProject?: ProjectCostSummary[];          // 按项目用量（多项目总览）
  costSummary?: CostSummary & { tokensByStage: Record<string, number>; tokensByModel?: Record<string, number>; tokensByBackend?: Record<string, number>; durationByStage?: Record<string, number>; stageBottlenecks?: PerfSample[] }; // 真实 flow 阶段史聚合出的确定性/LLM 调用成本摘要
  quota?: { accounts: { id: string; used: number; limit?: number; resetMs?: number; models: { model: string; calls: number }[]; health?: { ok: boolean; reason?: string } }[]; total: number };
  backendConfig?: BackendConfig;
  backendHealth?: {
    chain: string[];
    down: { backend: string; reason: string; kind: string; until: number }[];
    modelsDown: { backend: string; model: string; reason: string; kind: string; until: number }[];
  };
  /** 净省工时仪表:本项目真实 dev-cycle 的人工当量净省(北极星外部价值标尺)。 */
  savings?: SavingsRollup;
}

export interface DashboardState extends DashboardFlowState, DashboardQualityState, DashboardDesignState, DashboardProductState, DashboardOperationsState, DashboardCatalogState, DashboardCostState {
  rollbackHeatmap?: RollbackHeatmap;
}

export interface ProjectSnapshot { id: string; name: string; repoPath: string; state: DashboardState; error?: string; }
