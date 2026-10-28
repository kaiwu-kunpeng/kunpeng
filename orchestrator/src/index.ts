// 鲲鹏 orchestrator 的 public API surface（programmatic 嵌入入口）。
// CLI（`kunpeng`，见 cli.ts）是主入口；本文件显式声明对外稳定的编排积木。
// 未在此再导出的模块（HTTP 页面字符串、各 loop 内部细节等）一律视为 internal，
// 外部不应深链 dist 子路径——package.json 的 `exports` 字段会封锁深链（#2/#5）。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// 版本单一来源：从 package.json 读，避免与硬编码字符串漂移（#3）。
const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")) as { version: string };
export const version: string = pkg.version;

// 产物存储与状态机
export { ArtifactStore } from "./artifacts/store.js";
export { Artifact, ArtifactKind, ArtifactStatus, TRANSITIONS } from "./artifacts/types.js";

// 单写者工作区（worktree 隔离）
export { Workspace } from "./git/workspace.js";
export type { Flow } from "./git/workspace.js";

// 主开发循环
export { DevCycle } from "./loop/dev-cycle.js";
export type { DevCycleDeps, DevCycleResult } from "./loop/dev-cycle.js";

// 编程 SDK 门面
export { Kunpeng } from "./sdk/kunpeng.js";
export type { KunpengOptions, KunpengPlanOptions, KunpengRunOptions, GuardResult } from "./sdk/kunpeng.js";
export type { KunpengEvent, OnEvent } from "./sdk/events.js";
export { createContext } from "./sdk/context.js";
export type { OrchestratorContext } from "./sdk/context.js";

// 子 agent 后端（登录态 CLI）
export { CliRunner } from "./agent/cli-runner.js";
export type { AgentRunner } from "./agent/runner.js";
export { loadAccounts } from "./agent/account-pool.js";
export { loadQuota } from "./agent/quota-tracker.js";

// 流状态追踪
export { FlowTracker } from "./runtime/flowstate.js";
export type { FlowState, FlowStage, HumanGate } from "./runtime/flowstate.js";

// 验证门（差分验证）
export { runVerification, newFailures } from "./verify/gate.js";

// 方案编排
export { runPlan } from "./plan/orchestrator.js";
export { parseMethodPlan } from "./plan/parse.js";
export type { PlanModel, PlanPhase, PlanFlow, PlanResult, PlanFlowResult } from "./plan/types.js";

// 跨端看板
export { writeBoard } from "./board/write-board.js";
export type { BoardWriteResult } from "./board/write-board.js";

// 日志
export { createLogger } from "./runtime/logger.js";

// 目标项目探测
export { detectChecks } from "./project/detect.js";

// 项目身份与接管层（Block-1）
export { kunpengStateDir, slugify, registerProject, readRegistry, readProjectSelf } from "./project/registry.js";
export type { ProjectEntry } from "./project/registry.js";
export { renderOnboard, loadOnboardTemplate } from "./project/onboard.js";

// 可视化总控台（多项目聚合）
export { startDashboard, collectState, collectMultiState } from "./server/dashboard.js";
export type { DashboardState, ProjectSnapshot, DashboardOpts } from "./server/dashboard.js";

// 接线员工具
export { makeFlowId } from "./cli.js";
