import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { CliRunner } from "../agent/cli-runner.js";
import { ArtifactStore } from "../artifacts/store.js";
import { writeBoard } from "../board/write-board.js";
import { applyConventions } from "../evolution/apply-conventions.js";
import { buildCandidateSandbox } from "../evolution/candidate-sandbox.js";
import { buildEvalDeps } from "../evolution/eval-deps.js";
import { RegressionStore } from "../evolution/regression-store.js";
import { Workspace } from "../git/workspace.js";
import { parseGoalId } from "../goals/parse.js";
import { GOAL_ID_RE, GoalStore, goalsDir, isGoalId } from "../goals/store.js";
import { auditAcceptanceTest } from "../loop/audit.js";
import { appendAction, type OpsAction } from "../loop/action-ledger.js";
import { pickCrashedResumes, runAutopilot, runMultiRepoAutopilot, type AutopilotResult } from "../loop/autopilot.js";
import { gatherCrossProjectExperiences } from "../loop/cross-project-experience.js";
import { runLoopWave } from "../loop/driver.js";
import { pickNextTarget, runLoopAutopilot } from "../loop/loop-autopilot.js";
import { patrolUpstream, runPatrol, type PatrolCurveDeps } from "../loop/patrol.js";
import { getRecipe } from "../loop/recipe.js";
import { LoopStore } from "../loop/store.js";
import { parseLeverSpec, type LoopDef, type Wave } from "../loop/types.js";
import { translationPrompt } from "../plan/acceptance.js";
import { runPlan } from "../plan/orchestrator.js";
import { parseMethodPlan } from "../plan/parse.js";
import { formatLintReport, lintSpecText } from "../plan/spec-lint.js";
import { kunpengStateDir, readRegistry, readProjectSelf } from "../project/registry.js";
import { resolveProjectStateDir } from "../project/state-resolve.js";
import { AgentResearcher } from "../research/researcher.js";
import { daemonPlatform, installDaemonSchedule, realDaemonIo, renderScheduleHint, uninstallDaemonSchedule } from "../runtime/daemon-schedule.js";
import { resolveFlowLog, teeConsoleToFile } from "../runtime/flow-log.js";
import { FlowTracker } from "../runtime/flowstate.js";
import { makeBudgetCheck } from "../runtime/budget-guard.js";
import { loadRepoBudget } from "../runtime/flow-budget.js";
import { acquireFlowSlot, resolveMaxConcurrentFlows } from "../runtime/concurrency-slots.js";
import { mergeAndClearGate } from "../runtime/merge-gate.js";
import { recordControlPlaneChanges } from "../runtime/control-plane-audit.js";
import { recordAndWarn } from "../metrics/loop-yield-record.js";
import { createContext } from "../sdk/context.js";
import { buildAutopilotGuards } from "../server/autopilot-guards.js";
import { gateDiff } from "../server/gate-diff.js";
import { preReviewMerge, preReviewProposal } from "../server/pre-review.js";
import { checkStopSignal } from "../switchboard/checkpoint.js";
import { resolveIdentity } from "../switchboard/identity.js";
import { SwitchboardStore } from "../switchboard/store.js";
import { makeTaskBoardMirror, noopMirror } from "../taskboard/loop-mirror.js";
import { resolveRequireScope } from "../verify/scope-main-gate.js";
import { resolveRedFirst } from "../verify/red-first.js";
import { TaskBoard } from "../taskboard/store.js";
import { CliUsageError, registerCliCommand, type CliContext } from "./registry.js";
import { cliJsPath, loopStore } from "./shared.js";
import { fileSwitchboardSender } from "../switchboard/default-sender.js";

const LOOP_USAGE = "用法: kunpeng loop <register|record|resume|set-next|run|autopilot> ...";
const PLAN_USAGE = "用法: kunpeng plan <方案.md> [--repo <仓库>] [--concurrency N]";
export const AUTOPILOT_USAGE = "用法: kunpeng autopilot [--repo <path>]\n无参数：扫描全部注册项目并真合并；--repo 只处理一个仓库。\n仓库内存在 .kunpeng/autopilot-disabled 标记时，跳过该仓的自动合并、驳回与 resume。\n不接受子命令或位置参数（如 status），也不接受布尔开关；查状态请看 launchctl list 与 ~/.kunpeng/logs/kp-autopilot.log。";

const execFileAsync = promisify(execFile);

type ParsedLoopArgs = {
  values: Record<string, string>;
  multiValues: Record<string, string[]>;
  flags: Set<string>;
};

type LoopRecordInput = {
  id: string;
  lever: string;
  subject: string;
  delta: number;
  after: number;
  commit?: string;
  deploy?: string;
  verified: boolean;
  detail?: string;
  gotchas?: string[];
};

type LoopRecordDeps = {
  store: Pick<LoopStore, "appendWave" | "read">;
  tracker: Pick<FlowTracker, "start" | "finish">;
  now: () => number;
  stateDir: string;
  appendAction?: (stateDir: string, action: OpsAction) => Promise<void>;
};

type LegacyLoopRecordDeps = {
  store: Pick<LoopStore, "appendWave"> & Partial<Pick<LoopStore, "read">>;
  tracker: Pick<FlowTracker, "start" | "finish">;
  now: () => number;
  stateDir?: undefined;
  appendAction?: undefined;
};

function parseLoopArgs(args: string[]): ParsedLoopArgs {
  const values: Record<string, string> = {};
  const multiValues: Record<string, string[]> = {};
  const flags = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    if (arg === "--verified" || arg === "--auto-thin" || arg === "--autonomous") {
      flags.add(arg);
      continue;
    }
    const value = args[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${arg}`);
    i++;
    const key = arg.slice(2);
    if (key === "gotcha" || key === "lever") {
      multiValues[key] = [...(multiValues[key] ?? []), value];
      if (key === "lever") values[key] = value;
    } else {
      values[key] = value;
    }
  }
  return { values, multiValues, flags };
}

function requireArg(args: ParsedLoopArgs, key: string): string {
  const value = args.values[key];
  if (!value) throw new Error(`missing --${key}`);
  return value;
}

function optionalArg(args: ParsedLoopArgs, key: string): string | undefined {
  return args.values[key];
}

function numberArg(args: ParsedLoopArgs, key: string): number {
  const raw = requireArg(args, key);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${key} must be a finite number`);
  return value;
}

export async function recordLoopWave(
  input: LoopRecordInput,
  deps: LoopRecordDeps | LegacyLoopRecordDeps,
): Promise<{ wave: Wave; flowId: string }> {
  const at = deps.now();
  const waveWithoutSeq: Omit<Wave, "seq"> = {
    at,
    lever: input.lever,
    subject: input.subject,
    metricDelta: input.delta,
    metricAfter: input.after,
    verified: input.verified,
    ...(input.commit ? { commit: input.commit } : {}),
    ...(input.deploy ? { deploy: input.deploy } : {}),
    ...(input.detail ? { detail: input.detail } : {}),
    ...(input.gotchas?.length ? { gotchas: input.gotchas } : {}),
  };
  const wave = await deps.store.appendWave(input.id, waveWithoutSeq);
  if (deps.stateDir !== undefined && deps.store.read !== undefined) {
    try {
      const loop = await deps.store.read(input.id);
      if (loop) {
        await (deps.appendAction ?? appendAction)(deps.stateDir, {
          at,
          loopId: input.id,
          projectId: loop.projectId,
          recipe: loop.recipe,
          lever: input.lever,
          subject: input.subject,
          metricKey: loop.metric.key,
          metricAfter: input.after,
          metricDelta: input.delta,
          verified: input.verified,
          ...(input.commit ? { commit: input.commit } : {}),
          ...(input.deploy ? { deploy: input.deploy } : {}),
        });
      }
    } catch {
      // The ledger is observability data; a write failure must not fail the recorded wave.
    }
  }
  const flowId = `loop-${input.id}-w${wave.seq}`;
  await deps.tracker.start(flowId, input.subject);
  // 镜像 flow 的真实性必须随 wave 的 verified：未验证的 wave 绝不报成 verified（否则虚抬 cockpit 成功率）。
  if (input.verified) {
    await deps.tracker.finish(flowId, "verified");
  } else {
    await deps.tracker.finish(
      flowId,
      "rolled-back",
      undefined,
      `[loop-wave-unverified] ${input.detail ?? input.subject}`,
    );
  }
  return { wave, flowId };
}

async function handleLoopCommand(subcmd: string | undefined, rest: string[], repoRoot: string, extra: { goalId?: string } = {}): Promise<boolean> {
  if (!subcmd) throw new CliUsageError(LOOP_USAGE);
  const args = parseLoopArgs(rest);
  const store = loopStore(repoRoot);

  if (subcmd === "register") {
    if (extra.goalId !== undefined && !GOAL_ID_RE.test(extra.goalId)) {
      console.error(`[loop] invalid goal id: ${extra.goalId}`);
      process.exitCode = 1;
      return true;
    }
    const now = Date.now();
    const def: LoopDef = {
      id: requireArg(args, "id"),
      name: requireArg(args, "name"),
      projectId: requireArg(args, "project"),
      recipe: requireArg(args, "recipe"),
      ...(extra.goalId ? { goalId: extra.goalId } : {}),
      ...(args.flags.has("--autonomous") ? { autonomous: true } : {}),
      metric: {
        key: requireArg(args, "metric-key"),
        label: requireArg(args, "metric-label"),
        current: numberArg(args, "metric"),
      },
      levers: (args.multiValues.lever ?? []).map(parseLeverSpec),
      waves: [],
      createdAt: now,
      updatedAt: now,
    };
    await store.create(def);
    console.log(`[loop] registered ${def.id} goal=${def.goalId ?? "无"} levers=${def.levers.length}`);
    return true;
  }

  if (subcmd === "record") {
    const id = requireArg(args, "id");
    const stateDir = resolveProjectStateDir(repoRoot);
    const result = await recordLoopWave({
      id,
      lever: requireArg(args, "lever"),
      subject: requireArg(args, "subject"),
      delta: numberArg(args, "delta"),
      after: numberArg(args, "after"),
      commit: optionalArg(args, "commit"),
      deploy: optionalArg(args, "deploy"),
      verified: args.flags.has("--verified"),
      detail: optionalArg(args, "detail"),
      gotchas: args.multiValues.gotcha,
    }, {
      store,
      stateDir,
      tracker: new FlowTracker(stateDir),
      now: Date.now,
    });
    console.log(`[loop] recorded ${id} wave ${result.wave.seq} -> ${result.flowId}`);
    return true;
  }

  if (subcmd === "resume") {
    const id = requireArg(args, "id");
    const note = requireArg(args, "note");
    const loop = await store.read(id);
    const stateDir = resolveProjectStateDir(repoRoot);
    await appendAction(stateDir, {
      at: Date.now(),
      loopId: id,
      projectId: loop?.projectId ?? "",
      recipe: loop?.recipe ?? "",
      lever: "guard-reset",
      subject: note,
      metricKey: loop?.metric.key ?? "",
      metricAfter: loop?.metric.current ?? 0,
      metricDelta: 0,
      verified: true,
      guardReset: true,
      note,
    });
    console.log(`[loop] resume ${id}`);
    return true;
  }

  if (subcmd === "set-next") {
    const id = requireArg(args, "id");
    await store.setNext(id, {
      lever: requireArg(args, "lever"),
      ...(optionalArg(args, "target") ? { target: optionalArg(args, "target") } : {}),
      ...(optionalArg(args, "note") ? { note: optionalArg(args, "note") } : {}),
    });
    console.log(`[loop] next set for ${id}`);
    return true;
  }

  if (subcmd === "run") {
    const id = requireArg(args, "id");
    try {
      const result = await runLoopWave(id, { repoRoot, switchboard: fileSwitchboardSender() });
      if (result.gated) {
        console.log(`[loop] gated ${id}: ${result.humanGate.gate} - ${result.humanGate.what}`);
        return true;
      }

      console.log(
        `[loop] wave ${id} #${result.wave.seq} verified=${String(result.wave.verified)} delta=${result.wave.metricDelta}`,
      );
      if (!result.wave.verified) {
        process.exitCode = 2;
      }
      return true;
    } catch (error) {
      console.error(`[loop] error ${id}: ${(error as Error).message}`);
      process.exitCode = 2;
      return true;
    }
  }

  if (subcmd === "autopilot") {
    const id = requireArg(args, "id");
    const lever = requireArg(args, "lever");
    const maxRaw = optionalArg(args, "max");
    const maxWaves = maxRaw && Number.isFinite(Number(maxRaw)) && Number(maxRaw) > 0 ? Math.floor(Number(maxRaw)) : 5;
    const autoThin = args.flags.has("--auto-thin");
    let targets: string[];
    if (autoThin) {
      const thresholdRaw = optionalArg(args, "threshold");
      const minSuppliers =
        thresholdRaw && Number.isFinite(Number(thresholdRaw)) && Number(thresholdRaw) > 0
          ? Math.floor(Number(thresholdRaw))
          : 2;
      const loopDef = await store.read(id);
      if (!loopDef) {
        console.error(`[loop] 未知 loop ${id}`);
        process.exitCode = 2;
        return true;
      }
      const recipe = getRecipe(loopDef.recipe);
      if (!recipe.discoverWeakPoints) {
        console.error(`[loop] recipe ${loopDef.recipe} 不支持 --auto-thin`);
        process.exitCode = 2;
        return true;
      }
      try {
        const weak = await recipe.discoverWeakPoints(loopDef, { minSuppliers });
        targets = weak.slice().sort((a, b) => b.urgency - a.urgency).map((w) => w.target);
        console.log(`[loop] auto-thin: 发现 ${targets.length} 个薄弱点(供应商<${minSuppliers})：${targets.join(", ") || "(无)"}`);
      } catch (e) {
        console.error(`[loop] auto-thin 失败：${(e as Error).message}`);
        process.exitCode = 2;
        return true;
      }
    } else {
      targets = requireArg(args, "targets").split(",").map((s) => s.trim()).filter(Boolean);
    }

    const result = await runLoopAutopilot({
      loopId: id,
      maxWaves,
      readLoop: () => store.read(id),
      pickNext: (loop) => pickNextTarget(targets, loop, lever),
      setNext: (step) => store.setNext(id, { lever: step.lever, ...(step.target ? { target: step.target } : {}) }),
      driveWave: async () => {
        const waveResult = await runLoopWave(id, { repoRoot, switchboard: fileSwitchboardSender() });
        if (waveResult.gated) return { gated: true, verified: false };
        return { gated: false, verified: waveResult.wave.verified, metricDelta: waveResult.wave.metricDelta };
      },
      // ADR-0009 打断检查点：每波前查本实例有没有被喊停，命中则回执并停在波边界。
      onCheckpoint: async () => {
        const sb = new SwitchboardStore(join(kunpengStateDir(), "switchboard"));
        const me = resolveIdentity({ env: process.env.KUNPENG_INSTANCE, cwd: repoRoot });
        const { halt, acked } = await checkStopSignal(sb, me, {
          now: Date.now,
          id: () => `rcpt-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
        });
        if (halt) console.error(`[signal] ${me} 收到停止信号（已回执 ${acked.length} 条），loop autopilot 在下一波前优雅停止`);
        return halt;
      },
    });

    console.log(`[loop] autopilot ${id}: 跑了 ${result.waves.length} 波，stop=${result.stopReason}`);
    for (const wave of result.waves) {
      const target = wave.step.target ?? wave.step.lever;
      if (wave.error) {
        console.log(`  ✗ ${target} | error: ${wave.error}`);
      } else {
        console.log(
          `  ${wave.verified ? "✓" : "✗"} ${target} | delta=${wave.metricDelta ?? "?"}${wave.detail ? " | " + wave.detail : ""}`,
        );
      }
    }
    if (result.stopReason === "wave-failed" || result.stopReason === "error" || result.stopReason === "stopped") {
      process.exitCode = 2;
    }
    return true;
  }

  return false;
}

registerCliCommand({
  name: "loop",
  usage: LOOP_USAGE,
  run: async (context: CliContext) => {
    if (!(await handleLoopCommand(context.rest[0], context.rest.slice(1), context.repoRoot, { goalId: context.goalArg }))) {
      console.error("用法: kunpeng loop <register|record|resume|set-next|run> ...");
      process.exit(1);
    }
    return;
  },
});

registerCliCommand({
  name: "autopilot",
  usage: AUTOPILOT_USAGE,
  run: async (context: CliContext) => {
    const extras = [...(context.rest ?? []), ...(context.flags ?? [])];
    if (extras.length > 0) {
      throw new CliUsageError(`autopilot 不接受参数：${extras.join(" ")}；未执行任何合并\n${AUTOPILOT_USAGE}`);
    }
    const single = context.repoArg ?? process.env.KUNPENG_REPO;

    async function runOneRepo(rp: string): Promise<AutopilotResult> {
      const tracker = new FlowTracker(resolveProjectStateDir(rp));
      const cpChanges = recordControlPlaneChanges(rp);
      if (cpChanges.length > 0) {
        console.log(`[autopilot] 控制面变更 ${cpChanges.length} 条已记审计行: ${cpChanges.map((c) => c.file).join(", ")}`);
      }
      const res = await runAutopilot({
        tracker,
        merge: (flowId, base) => mergeAndClearGate(rp, flowId, base, { clearedBy: { by: "machine", via: "autopilot-cli" } }),
        ...buildAutopilotGuards(rp, tracker),
      });
      if (res.optedOut) return res;
      const flows = await tracker.list();
      for (const flowId of pickCrashedResumes(flows)) {
        const flow = flows.find((item) => item.flowId === flowId);
        if (!flow) continue;

        let hasCheckpoint: boolean;
        try {
          const { stdout } = await execFileAsync("git", ["tag", "--list", `kp-ckpt/${flowId}*`], { cwd: rp });
          hasCheckpoint = String(stdout).trim().length > 0;
        } catch {
          hasCheckpoint = false;
        }
        if (!hasCheckpoint) continue;

        const attempt = (flow.resumeAttempts ?? 0) + 1;
        await tracker.setResumeAttempts(flowId, attempt);
        const child = spawn(process.execPath, [cliJsPath(), "resume", flowId, "--repo", rp], {
          cwd: rp,
          detached: true,
          stdio: "ignore",
        });
        child.unref();
        console.log("[autopilot] 自动 resume crashed 流 " + flowId + "(第" + attempt + "次)");
      }
      return res;
    }

    function printRunDetails(res: AutopilotResult, indent = "  "): void {
      for (const flowId of res.merged) {
        console.log(`${indent}merged: ${flowId}`);
      }
      for (const item of res.rejected) {
        console.log(`${indent}rejected(自动驳回): ${item.flowId} ｜ ${item.reason}`);
      }
      for (const item of res.skipped) {
        console.log(`${indent}skipped: ${item.flowId} ｜ ${item.reason}`);
      }
    }

    if (single) {
      const rp = resolve(single);
      const res = await runOneRepo(rp);
      console.log(`[autopilot] ${rp} ｜ 自动合并 ${res.merged.length} 条 → main；自动驳回 ${res.rejected.length} 条；跳过 ${res.skipped.length} 条`);
      printRunDetails(res);
      if (res.optedOut) return;
      await recordAndWarn(rp, {
        loop: "autopilot",
        project: basename(rp),
        input: res.merged.length + res.rejected.length + res.skipped.length,
        // 自动驳回也是「真处理了」——只驳回不合并的一轮不算空转，否则会误报。
        yield: res.merged.length + res.rejected.length,
        // autopilot 是下游消费者，没有自己的上游待办：本轮无候选就是闲置，不报饿死。
        upstream: 0,
      });
      return;
    }

    const repos = (await readRegistry(kunpengStateDir()).catch(() => [])).map((p) => ({
      repoPath: p.repoPath,
      id: p.id,
      name: p.name,
    }));
    const multi = await runMultiRepoAutopilot({
      repos,
      runOne: (r) => runOneRepo(r.repoPath),
    });
    console.log(`[autopilot] 扫描 ${repos.length} 个项目 ｜ 共自动合并 ${multi.totalMerged} 条，自动驳回 ${multi.totalRejected} 条，跳过 ${multi.totalSkipped} 条`);
    for (const o of multi.outcomes) {
      const label = o.name ?? o.id ?? o.repoPath;
      if (o.error || !o.result) {
        // 跳过整仓（未跑出 result）不记账——本轮该项目根本没轮到。
        console.log(`  [${label}] 跳过整仓：${o.error ?? "unknown error"}`);
        continue;
      }
      console.log(`  [${label}] 合并 ${o.result.merged.length}，自动驳回 ${o.result.rejected.length}，跳过 ${o.result.skipped.length}`);
      printRunDetails(o.result, "    ");
      if (o.result.optedOut) continue;
      await recordAndWarn(o.repoPath, {
        loop: "autopilot",
        project: o.id ?? o.name ?? basename(o.repoPath),
        input: o.result.merged.length + o.result.rejected.length + o.result.skipped.length,
        yield: o.result.merged.length + o.result.rejected.length,
        upstream: 0,
      });
    }
    return;
  },
});

registerCliCommand({
  name: "plan",
  usage: PLAN_USAGE,
  run: async (context: CliContext) => {
    const planPath = context.rest[0];
    if (!planPath) { console.error(PLAN_USAGE); process.exit(1); }
    const md = await readFile(resolve(planPath), "utf8");
    const goalId = context.goalArg ?? parseGoalId(md);
    if (goalId !== undefined && !isGoalId(goalId)) {
      console.error(`[goal] 非法目标 id：${goalId}`);
      process.exit(1);
    }
    if (goalId && await new GoalStore(goalsDir(join(context.repoRoot, ".kunpeng"))).read(goalId) === null) {
      console.warn(`[goal] 未登记的目标 ${goalId}，仍按此 id 归属；用 kunpeng goal add 登记`);
    }
    const lintIssues = lintSpecText(md, context.repoRoot);
    if (lintIssues.length > 0) {
      const report = formatLintReport(lintIssues);
      if (lintIssues.some((item) => item.level === "error")) console.error(report);
      else console.warn(report);
    }
    if (lintIssues.some((item) => item.level === "error")) {
      process.exit(2);
    }
    const model = parseMethodPlan(md);
    const { store, ws, runner, tracker, checks, projectRules } = await createContext(context.repoRoot, context.kunpengHome);
    // spec 工位新职责：无显式验收的 flow → 翻译成验收命令，并过审计闸门（C3，弱则整盘中止）。
    for (const ph of model.phases) for (const f of ph.flows) {
      if (f.acceptanceCmd) continue;
      const t = await runner.run({ stage: "spec", system: projectRules, input: translationPrompt(f.requirement), tools: [] });
      const cmd2 = String(t.text).trim();
      const audit = auditAcceptanceTest(cmd2, { cwd: context.repoRoot });
      if (!audit.strong) { console.error(`[plan] flow ${f.id} 验收翻译过弱(${audit.reason})，整盘中止`); process.exit(2); }
      f.acceptanceCmd = cmd2;
    }
    const concurrency = context.concurrencyArg ? Math.max(1, Number(context.concurrencyArg)) : 3;
    const totalFlows = model.phases.reduce((a, p) => a + p.flows.length, 0);
    console.log(`[接线员] 方案 ${planPath} → ${model.phases.length} 段 / ${totalFlows} 流（后端 ${runner.backend}，并发 ${concurrency}）`);
    console.log(`💡 实时进度：开着 \`kunpeng serve\` 就能在总控台看本次流逐阶段推进（项目卡片「运行中的流」）；没开就另开终端跑 \`kunpeng serve <端口>\` 再刷新。`);
    const fl = resolveFlowLog(context.repoRoot, "plan");
    if (fl.minted) teeConsoleToFile(fl.logPath);
    const stateDir = resolveProjectStateDir(context.repoRoot);
    const mirror = process.env.KP_TASKBOARD_MIRROR === "0"
      ? noopMirror()
      : makeTaskBoardMirror(
          new TaskBoard(join(stateDir, "taskboard")),
          process.env.KUNPENG_INSTANCE ?? "loop",
        );
    const r = await runPlan(model, {
      goalId,
      budgetCheck: makeBudgetCheck({ repoRoot: context.repoRoot, tracker, env: process.env }),
      acquireSlot: () => acquireFlowSlot(join(context.repoRoot, ".kunpeng"), {
        max: resolveMaxConcurrentFlows(process.env, loadRepoBudget(join(context.repoRoot, ".kunpeng"))),
      }),
      repoRoot: context.repoRoot, store, ws, tracker, runner, checks, projectRules, concurrency, planRef: resolve(planPath),
      requireScope: resolveRequireScope(process.env),
      redFirst: resolveRedFirst(process.env),
      logPath: fl.logPath,
      mirror,
      // ADR-0009 打断检查点：段入口查本实例有没有被 `kunpeng signal --to` 喊停，命中则回执并优雅停。
      onCheckpoint: async () => {
        const sb = new SwitchboardStore(join(kunpengStateDir(), "switchboard"));
        const me = resolveIdentity({ env: process.env.KUNPENG_INSTANCE, cwd: process.cwd() });
        const { halt, acked } = await checkStopSignal(sb, me, {
          now: Date.now,
          id: () => `rcpt-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
        });
        if (halt) console.error(`[signal] ${me} 收到停止信号（已回执 ${acked.length} 条），plan 在本段前优雅停止`);
        return halt;
      },
    });
    console.log(`[结果] ${r.status} ｜ 集成分支 ${r.integrationBranch}${r.stoppedAtPhase !== undefined ? ` ｜ 停在第 ${r.stoppedAtPhase} 段` : ""}`);
    console.log(`  ${r.flows.filter((f) => f.status === "verified").length}/${r.flows.length} 流 verified${r.status === "verified" ? "，已挂「合并主干」人工门（待人工合并整条集成分支到主干）" : ""}`);
    if (r.integrationErrors?.length) {
      console.error(`  ❌ 集成检查门拦下（跨流类型不一致等，base 之外的新错 ${r.integrationErrors.length} 条）——未挂合并门：`);
      for (const e of r.integrationErrors.slice(0, 15)) console.error(`     ${e}`);
    }
    await writeBoard(context.repoRoot).catch(() => {}); // #3 自动刷新跨端看板（plan 跑完状态变了）
    process.exit(r.status === "verified" ? 0 : 2);
  },
});

registerCliCommand({
  name: "patrol",
  run: async (context: CliContext) => {
    // 定时自进化巡检（P2c）：跑一轮「想+攒」。默认内部每轮；--research 才外部（耗 token/联网）。
    // --install/--uninstall/--print-cron 管 OS 级调度（--install 是唯一系统副作用，显式触发）。
    const store = new ArtifactStore(join(context.repoRoot, ".kunpeng", "artifacts"));
    const cliPath = cliJsPath();
    const workingDir = resolve(dirname(cliPath), "..");  // orchestrator/（node_modules 所在）
    const cliJs = join(workingDir, "dist", "cli.js");
    const projectId =
      (await readProjectSelf(context.repoRoot))?.id ??
      (await readRegistry(kunpengStateDir())).find((p) => p.repoPath === context.repoRoot)?.id ??
      "default";
    const label = `com.kunpeng.patrol.${projectId}`;

    if (context.flags.has("--print-cron")) {
      const minutes = context.intervalArg ? Math.max(1, Math.round(Number(context.intervalArg) / 60)) : 60;
      console.log(renderScheduleHint({
        platform: daemonPlatform(),
        intervalMinutes: minutes,
        command: `${process.execPath} ${cliJs} patrol --repo ${context.repoRoot}`,
        label: "kunpeng-patrol",
      }));
      return;
    }
    if (context.flags.has("--uninstall")) {
      try {
        const r = await uninstallDaemonSchedule(label, daemonPlatform(), realDaemonIo());
        console.log(`[巡检] 已卸载定时调度：${r.removed.join(" ")}`);
      } catch (error) {
        console.error(`[巡检] ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
      return;
    }
    if (context.flags.has("--install")) {
      const intervalSeconds = context.intervalArg ? Math.max(60, Number(context.intervalArg)) : 3600;
      // R2：--install 时带上 --research [话题…] → 把"主动研究自身升级方向"烤进每日调度（否则只跑零 token 内部蒸馏）。
      const installArgs = [cliJs, "patrol", "--repo", context.repoRoot];
      if (context.flags.has("--all-projects")) installArgs.push("--all-projects");  // 把跨项目经验聚合烤进每日调度
      if (context.flags.has("--research")) { installArgs.push("--research"); if (context.rest.length) installArgs.push(...context.rest); }
      const spec = { label, binPath: process.execPath, args: installArgs, intervalSeconds, workingDir };
      try {
        const r = await installDaemonSchedule(spec, daemonPlatform(), realDaemonIo());
        console.log(`[巡检] 已安装定时巡检（唯一系统副作用，显式 --install）：`);
        console.log(`  调度文件: ${r.paths.join(" ")}`);
        console.log(`  间隔:   每 ${intervalSeconds}s 跑一次 patrol${context.flags.has("--research") ? " --research（含联网研究）" : ""} --repo ${context.repoRoot}`);
        console.log(`  卸载:   kunpeng patrol --repo ${context.repoRoot} --uninstall`);
      } catch (error) {
        console.error(`[巡检] ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
      return;
    }

    // 默认：跑一轮巡检循环。
    const doResearch = context.flags.has("--research");
    const researcher = doResearch ? new AgentResearcher(new CliRunner()) : undefined;
    const researchTopics = doResearch ? (context.rest.length ? context.rest : ["AI 研发工程化与多 agent 协作的最佳实践"]) : undefined;
    const tracker = new FlowTracker(resolveProjectStateDir(context.repoRoot));
    const regressionStore = new RegressionStore(join(context.repoRoot, ".kunpeng", "regression"));
    const quarantined = await regressionStore.listQuarantined();
    if (quarantined.length > 0) {
      console.log(`[巡检] 回归库隔离 ${quarantined.length} 条验收被截断的用例（不参与曲线）：${quarantined.slice(0, 5).map(({ task }) => task.id).join(" ")}`);
    }
    // --all-projects：聚合其它已注册项目的 experience 一起蒸馏（别项目踩的坑也进共享宪法）。
    let extraExperiences;
    if (context.flags.has("--all-projects")) {
      const projects = await readRegistry(kunpengStateDir());
      extraExperiences = await gatherCrossProjectExperiences(projects, context.repoRoot, (dir) => new ArtifactStore(dir));
      console.log(`[巡检] 跨项目经验聚合：从 ${projects.filter((p) => p.repoPath !== context.repoRoot).length} 个其它项目并入 ${extraExperiences.length} 条 experience`);
    }
    let curveDeps: PatrolCurveDeps | undefined;
    if ((await regressionStore.list("holdout")).length > 0) {
      const candidateWorkspace = new Workspace(context.repoRoot);
      curveDeps = {
        listHoldout: () => regressionStore.list("holdout"),
        runAcceptance: async (cmd, cwd) => {
          if (resolve(cwd) === resolve(context.repoRoot)) throw new Error("巡检基线验收不得在主工作区执行");
          const startedAt = Date.now();
          try {
            await execFileAsync("/bin/bash", ["-lc", cmd], { cwd, timeout: 120_000 });
            return { passed: true, ms: Date.now() - startedAt };
          } catch {
            return { passed: false, ms: Date.now() - startedAt };
          }
        },
        prepareCandidate: buildCandidateSandbox({
          acquire: (flowId, base) => candidateWorkspace.acquire(flowId, base),
          cleanup: (flowId) => candidateWorkspace.rollback(flowId),
          applyChanges: applyConventions,
          conventionsRelPath: "AGENTS.md",
          base: "main",
          newFlowId: () => `patrol-curve-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
          baselineFlowId: () => `patrol-base-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
        }),
      };
    }
    const r = await runPatrol({ store, tracker, regressionStore, evalDeps: buildEvalDeps(context.repoRoot), curveDeps, researcher, researchTopics, extraExperiences });
    console.log(`[巡检] 一轮完成：净新 ${r.freshChanges} · 重复 ${r.duplicateChanges} · 拒(core) ${r.rejected} · 外部研究 ${r.researched ? "是" : "否"} · 终态残留清理 ${r.staleCleared} · 沉淀 ${r.sedimented} · 无验真跳过 ${r.skippedExperiences}`);
    if (r.proposalId) console.log(`  → 落待审提案 ${r.proposalId}（draft，止于人工门 #2，绝不自动应用）`);
    else console.log(`  → 无净新改动，未生成提案（人审队列保持干净）`);
    await recordAndWarn(context.repoRoot, {
      loop: "patrol",
      project: basename(context.repoRoot),
      input: r.freshChanges,
      yield: r.proposalId ? r.freshChanges : 0,
      upstream: patrolUpstream(r),
    });
    // AI 预审：对尚未预审的草稿 artifact 做机器初判（幂等，已审跳过），随 patrol 定时自动跑；失败不挡巡检。
    try {
      const preReviewKinds = ["proposal", "release", "connector"] as const;
      const drafts = (await Promise.all(preReviewKinds.map((kind) => store.list(kind))))
        .flat()
        .filter((a) => a.status === "draft" && !(a.meta as { preReview?: unknown } | undefined)?.preReview);
      if (drafts.length) {
        const prRunner = new CliRunner();
        for (const a of drafts) {
          const pr = await preReviewProposal(a, prRunner);
          await store.write({ ...a, meta: { ...(a.meta ?? {}), preReview: pr } });
        }
        console.log(`  → AI 预审 ${drafts.length} 条草稿 artifact（proposal/release/connector，写 meta.preReview，人审 inbox 直接带初判）`);
      }
    } catch (e) {
      console.error(`  预审失败（不挡巡检）：${String(e)}`);
    }
    // 合并门不是 artifact：从 flow gate 拉 diff 后补机器初判。只写预审信息，绝不自动合并。
    try {
      const mergeGates = (await tracker.list()).filter((f) =>
        f.humanGate?.gate.includes("合并") && !f.humanGate.preReview,
      );
      if (mergeGates.length) {
        const prRunner = new CliRunner();
        let completed = 0;
        for (const f of mergeGates) {
          try {
            const diffResult = await gateDiff(context.repoRoot, f.flowId);
            if (!diffResult.ok) throw new Error(diffResult.error ?? "无法读取合并 diff");
            const pr = await preReviewMerge(diffResult.diff, prRunner);
            await tracker.setGatePreReview(f.flowId, pr);
            completed++;
          } catch (e) {
            console.error(`  合并门 ${f.flowId} 预审失败（跳过本条）：${String(e)}`);
          }
        }
        console.log(`  → AI 预审 ${completed}/${mergeGates.length} 条合并门（基于 diff 写 humanGate.preReview，不自动合并）`);
      }
    } catch (e) {
      console.error(`  合并门预审失败（不挡巡检）：${String(e)}`);
    }
    return;
  },
});
