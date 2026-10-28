import { computeSuspectedEscapes, formatSuspectedEscapes, gitMergedFlowChanges, titleOf } from "../metrics/suspected-escape.js";
import { readFile, writeFile, mkdir, readdir, appendFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { runBurnForecast } from "../metrics/burn-forecast-cmd.js";
import { buildMonthlyCostReport, type MonthlyCostRow } from "../runtime/cost-monthly.js";
import { buildHarnessYield, renderHarnessYield, type HarnessFlow } from "../runtime/cost-harness.js";
import { cacheHitRate, hitRateGrade, type CacheUsage } from "../metrics/cache-cost.js";
import { buildWeeklyReport } from "../metrics/weekly-report.js";
import { buildGateStats, formatGateStatsReport } from "../metrics/gate-ledger.js";
import { buildNorthstar, formatNorthstarReport, gitLogsForNorthstar, judgeStopLoss } from "../metrics/northstar.js";
import { parseMergedRecordsFromGitLog, parseRevertedFlowIds } from "../metrics/flow-records.js";
import { buildRollbackCategoryStats, formatRollbackCategoryReport } from "../metrics/rollback-category.js";
import { clusterFailures, failureSignature } from "../metrics/failure-signature.js";
import { readRecentFailureItems, readWeeklyFlows } from "../metrics/flow-failures.js";
import { writeRecurrenceRules } from "../metrics/rollback-recurrence.js";
import { backfillRollbackAttribution, buildRollbackHeatmap, renderHeatmapText } from "../metrics/rollback-heatmap.js";
import { backfillReceipts, receiptCoverage, renderReceiptReport } from "../metrics/receipts.js";
import { savingsByMonth, aggregateSavings, aggregateSavingsLegacy, HUMAN_EQUIV_MINUTES, savingsV2 } from "../metrics/time-saved.js";
import { maintenanceMinutes } from "../metrics/maintenance-ledger.js";
import { renderSavingsV2 } from "../metrics/savings-render.js";
import { gitLogsForEscapeRate, buildEscapeRateFromLogs, formatEscapeRateReport, rolledBackFlowIdsFromStates } from "../metrics/escape-rate-report.js";
import { FlowTracker } from "../runtime/flowstate.js";
import { readControlPlaneAudit } from "../runtime/control-plane-audit.js";
import { resolveProjectStateDir } from "../project/state-resolve.js";
import { readRegistry, kunpengStateDir } from "../project/registry.js";
import { createContext } from "../sdk/context.js";
import { collectState } from "../server/state.js";
import { renderModuleStatusCli } from "../status/render-cli.js";
import {
  computeTokenCoverage,
  excludeAggregates,
  isAggregateFlowId,
  summarizeStageTokens,
  type FlowTokenSample,
} from "../objects/flow-metrics.js";
import { buildStageCostRows, renderStageCostReport } from "../objects/stage-report.js";
import {
  renderRepairAttemptReport,
  summarizeRepairAttempts,
  type RepairAttemptSample,
} from "../objects/repair-metrics.js";
import { isRecord } from "./shared.js";
import { registerCliCommand, type CliContext } from "./registry.js";

registerCliCommand({
  name: "control-plane-audit",
  run: (context: CliContext) => {
    const index = context.rest.indexOf("--limit");
    const limit = index < 0 ? 100 : Number(context.rest[index + 1]);
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      console.error("用法: kunpeng control-plane-audit [--limit N]（N 必须为正整数）");
      process.exit(1);
    }
    const changes = readControlPlaneAudit(kunpengStateDir(), limit);
    if (changes.length === 0) {
      console.log("控制面审计账本为空");
      return;
    }
    for (const change of changes) {
      console.log(`${new Date(change.at).toISOString()} ｜ ${change.repoRoot} ｜ ${change.file} ｜ ${change.before.slice(0, 8)} → ${change.after.slice(0, 8)}`);
    }
  },
});

registerCliCommand({
  name: "burn-forecast",
  run: (context: CliContext) => {
    const spentUsd = Number(context.rest[0]);
    const budgetUsd = Number(context.rest[1]);
    const elapsedHours = Number(context.rest[2]);
    if (
      context.rest[0] === undefined ||
      context.rest[1] === undefined ||
      context.rest[2] === undefined ||
      !Number.isFinite(spentUsd) ||
      !Number.isFinite(budgetUsd) ||
      !Number.isFinite(elapsedHours)
    ) {
      console.error("用法: kunpeng burn-forecast <spentUsd> <budgetUsd> <elapsedHours>");
      process.exit(1);
    }
    process.exit(runBurnForecast(spentUsd, budgetUsd, elapsedHours));
  },
});

registerCliCommand({
  name: "cost-report",
  run: async (context: CliContext) => {
    const args = parseCostReportArgs(context.rest);
    if (!args.ok) {
      console.error(args.error);
      process.exit(1);
    }
    if (args.receipts) {
      const tracker = new FlowTracker(resolveProjectStateDir(context.repoRoot));
      const flows = await tracker.list();
      console.log(renderReceiptReport(receiptCoverage(flows)));
      if (args.backfill) {
        const r = await backfillReceipts(tracker, { repoRoot: context.repoRoot, dryRun: args.dryRun });
        console.log(`回填收据：扫描 ${r.scanned}，补齐 ${r.filled}，找不到会话 ${r.notFound.length}${args.dryRun ? "（dry-run 未写盘）" : ""}`);
        for (const entry of r.entries) {
          console.log(`  ${entry.flowId} ← ${entry.source} in=${entry.input} out=${entry.output}`);
        }
      }
      return;
    }
    const flows = await readMonthlyCostFlows(context.repoRoot);
    if (args.byHarness) {
      const rows = buildHarnessYield(flows as unknown as HarnessFlow[], { sinceMs: Date.now() - args.days * 86_400_000 });
      console.log(args.json ? JSON.stringify(rows, null, 2) : renderHarnessYield(rows, args.days));
      return;
    }
    if (args.byStage) {
      const samples = excludeAggregates(flows);
      const coverage = computeTokenCoverage(samples);
      const rows = buildStageCostRows(summarizeStageTokens(samples));
      console.log(args.json ? JSON.stringify({ rows, coverage }, null, 2) : renderStageCostReport(rows, coverage));
      return;
    }
    if (args.byAttempt) {
      const rows = summarizeRepairAttempts(
        flows.filter((flow) => !isAggregateFlowId(flow.flowId)),
      );
      console.log(args.json ? JSON.stringify(rows, null, 2) : renderRepairAttemptReport(rows));
      return;
    }
    let rows = buildMonthlyCostReport(flows);
    if (args.month !== undefined) {
      rows = rows.filter((row) => row.month === args.month);
    }
    if (rows.length === 0) {
      console.log("暂无用量数据");
      return;
    }
    const overallCacheHitRate = monthlyCacheHitRate(flows, args.month);
    console.log(args.json ? JSON.stringify(rows, null, 2) : renderMonthlyCostTable(rows, overallCacheHitRate));
    return;
  },
});

registerCliCommand({
  name: "weekly",
  run: async (context: CliContext) => {
    const args = parseWeeklyArgs(context.argv);
    if (!args.ok) {
      console.error(args.error);
      process.exit(1);
    }
    const now = Date.now();
    const stateDir = resolveProjectStateDir(args.repoRoot);
    const flows = await readWeeklyFlows(stateDir);
    const report = buildWeeklyReport({
      flows,
      sinceMs: now - args.days * 86_400_000,
      untilMs: now,
    });
    const reportPath = join(stateDir, "reports", `weekly-${new Date(now).toISOString().slice(0, 10)}.md`);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, report, "utf8");
    process.stdout.write(`${report}\n`);
    console.log(`周报已写入：${reportPath}`);
    return;
  },
});

registerCliCommand({
  name: "failures",
  run: async (context: CliContext) => {
    const args = parseFailuresArgs(context.argv);
    if (!args.ok) {
      console.error(args.error);
      process.exit(1);
    }
    if (args.lintRules) {
      const stateDir = resolveProjectStateDir(args.repoRoot);
      const flows = await new FlowTracker(stateDir).list();
      const { path, file } = await writeRecurrenceRules(dirname(stateDir), flows, { now: Date.now(), sinceDays: args.days });
      console.log(`spec-lint 规则已写入：${path}（${file.rules.length} 条）`);
    }
    const stateDir = resolveProjectStateDir(args.repoRoot);
    const now = Date.now();
    if (args.backfill) {
      const r = await backfillRollbackAttribution(new FlowTracker(stateDir), { dryRun: args.dryRun });
      console.log(`回填回滚归因：扫描 ${r.scanned}，更新 ${r.updated}，已有 ${r.skippedHasRollback}，unknown ${r.unknown}${args.dryRun ? "（dry-run 未写盘）" : ""}`);
      for (const { flowId, kind } of r.entries) console.log(`  ${flowId} → ${kind}`);
    }
    if (args.heatmap) {
      console.log(renderHeatmapText(buildRollbackHeatmap(await new FlowTracker(stateDir).list(), { sinceMs: now - args.days * 86_400_000 })));
    }
    const items = await readRecentFailureItems(resolveProjectStateDir(args.repoRoot), args.days, Date.now());
    const groups = clusterFailures(items);
    if (groups.length === 0) {
      console.log(`最近 ${args.days} 天没有失败流 ✅`);
      return;
    }
    console.log("Top 失败模式");
    groups.forEach((group, index) => {
      const signature = failureSignature(group.sample).slice(0, 80);
      console.log(`#${index + 1} ×${group.count} ｜ ${signature}`);
      for (const id of group.ids.slice(0, 3)) console.log(`  ${id}`);
      if (group.ids.length > 3) console.log(`  +${group.ids.length - 3} more`);
    });
    return;
  },
});

registerCliCommand({
  name: "status",
  run: async (context: CliContext) => {
    const { store } = await createContext(context.repoRoot, context.kunpengHome);
    const ds = await collectState(store, context.repoRoot, { kunpengHome: context.kunpengHome });
    if (!ds.moduleStatus) { console.error("[status] 未能采集模块状态"); process.exit(2); return; }
    console.log(renderModuleStatusCli(ds.moduleStatus));
    return;
  },
});

registerCliCommand({
  name: "savings",
  run: async (context: CliContext) => {
    const compareLegacy = context.rest.includes("--compare-legacy") || context.flags.has("--compare-legacy");
    if (context.rest.includes("--all-projects") || context.flags.has("--all-projects")) {
      const projects = await readRegistry(kunpengStateDir());
      console.log(`[净省工时·跨项目] 仅计真实 dev-cycle（history 进入 implement 且 verified）`);
      let grandNet = 0;
      let grandDev = 0;
      let grandDataOps = 0;
      for (const p of projects) {
        const pf = await new FlowTracker(resolveProjectStateDir(p.repoPath)).list().catch(() => []);
        const r = aggregateSavings(pf);
        console.log(`  ${p.name}: 净省 ${r.netSavedHours}h ｜ verified工程流 ${r.verifiedDevFlows} ｜ 数据运营 ${r.dataOpsFlows} 不计`);
        console.log(`    新口径: 顶层 ${r.topLevelFlows} ｜ 负值 ${r.negativeFlows}`);
        if (compareLegacy) console.log(`    旧口径: 净省 ${aggregateSavingsLegacy(pf).netSavedHours}h`);
        grandNet += r.netSavedHours;
        grandDev += r.verifiedDevFlows;
        grandDataOps += r.dataOpsFlows;
      }
      console.log(`  ── 跨项目合计: 净省 ${Math.round(grandNet * 10) / 10} 工程小时（${grandDev} 个 verified 工程流，跨 ${projects.length} 个项目；${grandDataOps} 数据运营条目不计）`);
      return;
    }
    const stateDir = resolveProjectStateDir(context.repoRoot);
    const tracker = new FlowTracker(stateDir);
    const flows = await tracker.list();
    const v2 = savingsV2(flows, { maintenanceMinutes: maintenanceMinutes(stateDir) });
    if (v2.assumptions.source === "env") {
      const auditPath = join(kunpengStateDir(), "audit", "savings-assumptions.jsonl");
      await mkdir(dirname(auditPath), { recursive: true });
      await appendFile(auditPath, JSON.stringify({
        at: Date.now(),
        repoRoot: context.repoRoot,
        humanEquivMinutes: v2.assumptions.humanEquivMinutes,
        source: "env",
      }) + "\n", "utf8");
      console.warn("[净省工时] 人工当量环境变量覆盖，已记审计行");
    }
    const byMonth = savingsByMonth(flows);
    const total = aggregateSavings(flows);
    const project = context.repoRoot.split("/").filter(Boolean).pop() ?? "project";
    console.log(`[净省工时] 项目 ${project}（仅计真实 dev-cycle：history 进入 implement 且 verified；人工当量基准: simple ${HUMAN_EQUIV_MINUTES.simple}min / complex ${HUMAN_EQUIV_MINUTES.complex}min，保守估，可校准）`);
    for (const month of Object.keys(byMonth).sort()) {
      const r = byMonth[month];
      console.log(`  ${month}: verified dev ${r.verifiedDevFlows}/${r.devFlows} 流 | 维护不计入 ${r.maintenanceFlows} 流 | 数据运营不计入 ${r.dataOpsFlows} 流 | 估人工 ${r.humanEstimateHours}h − loop ${r.loopActualHours}h = 净省 ${r.netSavedHours}h`);
    }
    console.log(`  合计: 净省 ${total.netSavedHours} 工程小时（仅计真实 dev-cycle ${total.verifiedDevFlows}/${total.devFlows} 流；维护不计入 ${total.maintenanceFlows} 流，数据运营不计入 ${total.dataOpsFlows} 流，总流 ${total.flows}；loop 实际 ${total.loopActualHours}h）`);
    for (const line of renderSavingsV2(v2)) {
      console.log(line);
    }
    if (compareLegacy) {
      const legacy = aggregateSavingsLegacy(flows);
      console.log(`[口径对照] 旧口径 净省 ${legacy.netSavedHours}h（verified ${legacy.verifiedDevFlows}）`);
      console.log(`[口径对照] 新口径 净省 ${total.netSavedHours}h（verified ${total.verifiedDevFlows}，顶层 ${total.topLevelFlows}，负值 ${total.negativeFlows}）`);
      console.log(`[口径对照] 差值 ${Math.round((total.netSavedHours - legacy.netSavedHours) * 10) / 10}h —— 口径变更属宪法 C5 第二类，需人工门签字后才作为北极星取值`);
    }
    return;
  },
});

registerCliCommand({
  name: "gate-stats",
  run: async (context: CliContext) => {
    const daysIndex = context.rest.indexOf("--days");
    const days = daysIndex < 0 ? 21 : Number(context.rest[daysIndex + 1]);
    if (!Number.isFinite(days) || days <= 0) {
      console.error("用法: kunpeng gate-stats [--days 21] [--all-projects] [--repo <路径>]（days 必须为正数）");
      process.exit(1);
    }
    const untilMs = Date.now();
    const window = { sinceMs: untilMs - days * 86_400_000, untilMs };
    if (context.rest.includes("--all-projects") || context.flags.has("--all-projects")) {
      const projects = await readRegistry(kunpengStateDir());
      for (const project of projects) {
        const flows = await new FlowTracker(resolveProjectStateDir(project.repoPath)).list();
        console.log(formatGateStatsReport(buildGateStats(flows, window), project.name));
        console.log(formatRollbackCategoryReport(buildRollbackCategoryStats(flows, window)));
      }
      return;
    }
    const flows = await new FlowTracker(resolveProjectStateDir(context.repoRoot)).list();
    console.log(formatGateStatsReport(buildGateStats(flows, window), context.repoRoot));
    console.log(formatRollbackCategoryReport(buildRollbackCategoryStats(flows, window)));
  },
});

registerCliCommand({
  name: "northstar",
  run: async (context: CliContext) => {
    const weeksIndex = context.rest.indexOf("--weeks");
    const weeks = weeksIndex < 0 ? 8 : Number(context.rest[weeksIndex + 1]);
    if (!Number.isSafeInteger(weeks) || weeks <= 0) {
      console.error("用法: kunpeng northstar [--weeks 8] [--all-projects]（weeks 必须为正整数）");
      process.exit(1);
    }
    const now = Date.now();
    const reportFor = async (root: string, label?: string): Promise<string> => {
      const { mergedLog, revertLog } = await gitLogsForNorthstar(root);
      const flows = await new FlowTracker(resolveProjectStateDir(root)).list().catch(() => []);
      const merges = parseMergedRecordsFromGitLog(mergedLog).flatMap((record) =>
        record.mergedAt === undefined ? [] : [{ flowId: record.flowId, mergedAt: record.mergedAt }],
      );
      const reverted = parseRevertedFlowIds(revertLog);
      const report = buildNorthstar(merges, reverted, flows, { now, weeks });
      const stopLoss = judgeStopLoss(merges, reverted, flows, { now });
      return formatNorthstarReport(report, label, stopLoss);
    };
    if (context.rest.includes("--all-projects") || context.flags.has("--all-projects")) {
      const projects = await readRegistry(kunpengStateDir());
      for (const project of projects) {
        console.log(await reportFor(project.repoPath, project.name));
      }
      return;
    }
    console.log(await reportFor(context.repoRoot));
  },
});

registerCliCommand({
  name: "escape-rate",
  run: async (context: CliContext) => {
    // 缺陷逃逸率：合并后被 git-revert 或 FlowState 标 rolled-back 的占比，量化合并门/accept 的真实拦截力。
    // --window <天> 限定近 N 天合并的；--all-projects 跨项目逐个报。
    const windowArg = (() => {
      const i = context.rest.indexOf("--window");
      const v = i >= 0 ? Number(context.rest[i + 1]) : NaN;
      return Number.isFinite(v) && v > 0 ? v : undefined;
    })();
    const windowMs = windowArg !== undefined ? windowArg * 24 * 60 * 60 * 1000 : undefined;
    const windowLabel = windowArg !== undefined ? `近${windowArg}天` : undefined;
    const reportFor = async (root: string): Promise<string> => {
      const { mergedLog, revertLog } = await gitLogsForEscapeRate(root);
      const states = await new FlowTracker(resolveProjectStateDir(root)).list().catch(() => []);
      const rolledBack = rolledBackFlowIdsFromStates(states.map((s) => ({ flowId: s.flowId, status: s.status })));
      const er = buildEscapeRateFromLogs(mergedLog, revertLog, rolledBack, windowMs !== undefined ? { windowMs } : undefined);
      // 第二列：疑似逃逸（fix-forward 习惯下只数 revert 会失真）；缺省看近 30 天的合并。
      const titles = new Map(states.map((s) => [s.flowId, titleOf(s.requirement)]));
      const changes = await gitMergedFlowChanges(root, {
        sinceMs: Date.now() - (windowMs ?? 30 * 24 * 60 * 60 * 1000),
        titleFor: (flowId) => titles.get(flowId),
      }).catch(() => []);
      return [
        formatEscapeRateReport(er, windowLabel ? { windowLabel } : undefined),
        formatSuspectedEscapes(changes.length, computeSuspectedEscapes(changes)),
      ].join("\n");
    };
    if (context.rest.includes("--all-projects")) {
      const projects = await readRegistry(kunpengStateDir());
      for (const p of projects) {
        console.log(`【${p.name}】`);
        console.log(await reportFor(p.repoPath));
        console.log("");
      }
      return;
    }
    console.log(await reportFor(context.repoRoot));
    return;
  },
});

type MonthlyCostFlowInput = Parameters<typeof buildMonthlyCostReport>[0][number] & FlowTokenSample & RepairAttemptSample;

type ParsedWeeklyArgs =
  | { ok: true; days: number; repoRoot: string }
  | { ok: false; error: string };

const WEEKLY_USAGE = "用法: kunpeng weekly [--days 7] [--repo <路径>]";

function parseWeeklyArgs(argv: string[]): ParsedWeeklyArgs {
  let days = 7;
  let repo = process.env.KUNPENG_REPO ?? process.cwd();
  let commandSeen = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "weekly" && !commandSeen) {
      commandSeen = true;
      continue;
    }
    if (arg === "--days") {
      const value = argv[++i];
      const parsed = Number(value);
      if (
        value === undefined ||
        !/^[1-9]\d*$/.test(value) ||
        !Number.isSafeInteger(parsed) ||
        parsed > Math.floor(Number.MAX_SAFE_INTEGER / 86_400_000)
      ) {
        return { ok: false, error: WEEKLY_USAGE };
      }
      days = parsed;
      continue;
    }
    if (arg === "--repo") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) return { ok: false, error: WEEKLY_USAGE };
      repo = value;
      continue;
    }
    return { ok: false, error: `未知参数: ${arg}\n${WEEKLY_USAGE}` };
  }

  return { ok: true, days, repoRoot: resolve(repo) };
}

type ParsedFailuresArgs =
  | { ok: true; days: number; repoRoot: string; lintRules: boolean; heatmap: boolean; backfill: boolean; dryRun: boolean }
  | { ok: false; error: string };

const FAILURES_USAGE = "用法: kunpeng failures [--days 7] [--lint-rules] [--heatmap] [--backfill [--dry-run]] [--repo <路径>]";

function parseFailuresArgs(argv: string[]): ParsedFailuresArgs {
  let days = 7;
  let lintRules = false;
  let heatmap = false;
  let backfill = false;
  let dryRun = false;
  let repo = process.env.KUNPENG_REPO ?? process.cwd();
  let commandSeen = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "failures" && !commandSeen) {
      commandSeen = true;
      continue;
    }
    if (arg === "--lint-rules") {
      lintRules = true;
      continue;
    }
    if (arg === "--heatmap") {
      heatmap = true;
      continue;
    }
    if (arg === "--backfill") {
      backfill = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--days") {
      const value = argv[++i];
      const parsed = Number(value);
      if (value === undefined || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(parsed)) {
        return { ok: false, error: FAILURES_USAGE };
      }
      days = parsed;
      continue;
    }
    if (arg === "--repo") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) return { ok: false, error: FAILURES_USAGE };
      repo = value;
      continue;
    }
    return { ok: false, error: `未知参数: ${arg}\n${FAILURES_USAGE}` };
  }

  return { ok: true, days, repoRoot: resolve(repo), lintRules, heatmap, backfill, dryRun };
}

type ParsedCostReportArgs =
  | { ok: true; month?: string; json: boolean; byStage: boolean; byAttempt: boolean; receipts: boolean; backfill: boolean; dryRun: boolean; byHarness: boolean; days: number }
  | { ok: false; error: string };

export function parseCostReportArgs(args: string[]): ParsedCostReportArgs {
  let month: string | undefined;
  let json = false;
  let byStage = false;
  let byAttempt = false;
  let receipts = false;
  let backfill = false;
  let dryRun = false;
  let byHarness = false;
  let days = 30;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--by-harness") {
      byHarness = true;
      continue;
    }
    if (arg === "--days") {
      const value = Number(args[++i]);
      if (!Number.isInteger(value) || value < 1 || value > 365) {
        return { ok: false, error: "--days 需要 1-365 的整数" };
      }
      days = value;
      continue;
    }
    if (arg === "--by-stage") {
      byStage = true;
      continue;
    }
    if (arg === "--by-attempt") {
      byAttempt = true;
      continue;
    }
    if (arg === "--receipts") {
      receipts = true;
      continue;
    }
    if (arg === "--backfill") {
      backfill = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--month") {
      const value = args[++i];
      if (value === undefined || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
        return { ok: false, error: "用法: kunpeng cost-report [--repo <dir>] [--month YYYY-MM] [--json] [--by-stage] [--by-attempt] [--by-harness [--days N]] [--receipts [--backfill [--dry-run]]]" };
      }
      month = value;
      continue;
    }
    return { ok: false, error: `未知参数: ${arg}\n用法: kunpeng cost-report [--repo <dir>] [--month YYYY-MM] [--json] [--by-stage] [--by-attempt] [--by-harness [--days N]] [--receipts [--backfill [--dry-run]]]` };
  }
  return { ok: true, month, json, byStage, byAttempt, receipts, backfill, dryRun, byHarness, days };
}

async function readMonthlyCostFlows(repoRoot: string): Promise<MonthlyCostFlowInput[]> {
  const stateDir = resolveProjectStateDir(repoRoot);
  const files = (await readdir(stateDir).catch((): string[] => [])).filter((file) => file.endsWith(".json"));
  const flows: MonthlyCostFlowInput[] = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(await readFile(join(stateDir, file), "utf8")) as unknown;
      if (isRecord(parsed)) flows.push(parsed as unknown as MonthlyCostFlowInput);
    } catch {
      // 单个损坏的 flow 文件不应影响整份报表。
    }
  }
  return flows;
}

function displayWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    width += char.charCodeAt(0) > 0xff ? 2 : 1;
  }
  return width;
}

function padCell(value: string, width: number, align: "left" | "right" = "left"): string {
  const spaces = " ".repeat(Math.max(0, width - displayWidth(value)));
  return align === "right" ? `${spaces}${value}` : `${value}${spaces}`;
}

function monthlyCacheHitRate(flows: MonthlyCostFlowInput[], month?: string): number | null {
  const total: CacheUsage = { input: 0, cacheCreate: 0, cacheRead: 0 };
  const addRecord = (record: Record<string, unknown>): void => {
    for (const key of ["input", "cacheCreate", "cacheRead"] as const) {
      const value = record[key];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) total[key] += value;
    }
  };

  for (const flow of flows as unknown[]) {
    if (!isRecord(flow)) continue;
    if (month !== undefined) {
      const updatedAt = flow.updatedAt;
      if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) continue;
      const date = new Date(updatedAt);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 7) !== month) continue;
    }

    if (isRecord(flow.tokenQuad)) {
      addRecord(flow.tokenQuad);
      continue;
    }
    const stageUsage = flow.stageUsage;
    if (isRecord(stageUsage)) {
      const entries = Object.values(stageUsage).filter(isRecord);
      if (entries.length > 0) {
        for (const usage of entries) addRecord(usage);
        continue;
      }
    }
    if (isRecord(flow.usage)) {
      addRecord(flow.usage);
      continue;
    }
    addRecord(flow);
  }

  return cacheHitRate(total);
}

function formatCacheHitRate(rate: number | null): string {
  const grade = hitRateGrade(rate);
  const marker = { good: "✅", warn: "⚠️", bad: "❌", "n/a": "—" }[grade];
  return rate === null ? marker : `${(rate * 100).toFixed(1)}% ${marker}`;
}

function renderMonthlyCostTable(rows: MonthlyCostRow[], overallCacheHitRate: number | null): string {
  const body = rows.map((row) => ({
    month: row.month,
    model: row.model,
    tokens: String(row.tokens),
    usd: row.usd.toFixed(4),
  }));
  const totalTokens = rows.reduce((sum, row) => sum + row.tokens, 0);
  const totalUsd = rows.reduce((sum, row) => sum + row.usd, 0);
  body.push({ month: "总计", model: "", tokens: String(totalTokens), usd: totalUsd.toFixed(4) });

  const headers = { month: "月份", model: "模型", tokens: "tokens", usd: "估算USD" };
  const widths = {
    month: Math.max(displayWidth(headers.month), ...body.map((row) => displayWidth(row.month))),
    model: Math.max(displayWidth(headers.model), ...body.map((row) => displayWidth(row.model))),
    tokens: Math.max(displayWidth(headers.tokens), ...body.map((row) => displayWidth(row.tokens))),
    usd: Math.max(displayWidth(headers.usd), ...body.map((row) => displayWidth(row.usd))),
  };
  const lines = [
    [
      padCell(headers.month, widths.month),
      padCell(headers.model, widths.model),
      padCell(headers.tokens, widths.tokens, "right"),
      padCell(headers.usd, widths.usd, "right"),
    ].join("  "),
  ];
  for (const row of body) {
    lines.push([
      padCell(row.month, widths.month),
      padCell(row.model, widths.model),
      padCell(row.tokens, widths.tokens, "right"),
      padCell(row.usd, widths.usd, "right"),
    ].join("  "));
  }
  lines.push(`缓存命中率  ${formatCacheHitRate(overallCacheHitRate)}`);
  return lines.join("\n");
}
