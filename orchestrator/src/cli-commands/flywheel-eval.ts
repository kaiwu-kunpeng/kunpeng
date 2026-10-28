import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { CliRunner } from "../agent/cli-runner.js";
import { ArtifactStore } from "../artifacts/store.js";
import { writeBoard } from "../board/write-board.js";
import { attachEvidence, buildEvalDeps } from "../evolution/eval-deps.js";
import { evaluateHoldoutReliability } from "../evolution/eval-runner.js";
import { evolutionProposalFromArtifact } from "../evolution/apply.js";
import { markProposalRoute, pendingFromArtifact, sweepProposals } from "../evolution/proposal-to-backlog.js";
import { RegressionStore, holdoutRerunBase } from "../evolution/regression-store.js";
import { evaluateProposal } from "../evolution/run-proposal-eval.js";
import { runBacklogDriver } from "../feedback/drive-backlog.js";
import { acceptanceCmdForSource, stableHash } from "../feedback/finding-to-task.js";
import { runFlywheelRound, countActiveLocks } from "../feedback/flywheel.js";
import { ReinjectStore } from "../feedback/reinject-store.js";
import { runReinjectScan } from "../feedback/reinject.js";
import { Workspace } from "../git/workspace.js";
import { runBestOfN } from "../loop/best-of-n-runner.js";
import { DevCycle } from "../loop/dev-cycle.js";
import { runGuardian, DEFAULT_SCANNERS } from "../loop/guardian.js";
import { renderCrontabLine } from "../loop/schedule.js";
import { buildProposal, persistProposal } from "../loop/self-evolution.js";
import { parseMethodPlan } from "../plan/parse.js";
import { detectChecks } from "../project/detect.js";
import { kunpengStateDir, readRegistry, readProjectSelf } from "../project/registry.js";
import { daemonPlatform, installDaemonSchedule, uninstallDaemonSchedule, realDaemonIo } from "../runtime/daemon-schedule.js";
import { resolveFlowLog, teeConsoleToFile } from "../runtime/flow-log.js";
import { createContext } from "../sdk/context.js";
import { recordAndWarn } from "../metrics/loop-yield-record.js";
import { makeFlowId } from "../util/flow-id.js";
import { runVerification } from "../verify/gate.js";
import { CliUsageError, registerCliCommand, type CliContext } from "./registry.js";
import { cliJsPath } from "./shared.js";

const EVALUATE_USAGE = "用法: kunpeng evaluate <proposalId> [--differential] [--limit N] [--repo <仓库>]";

const PROPOSAL_ROUTE_TERMINAL_STATUSES = new Set([
  "auto-enqueued",
  "auto-rejected",
  "human-review",
]);

const PROPOSAL_ARTIFACT_TERMINAL_STATUSES = new Set([
  "rejected",
  "discarded",
  "verified",
]);

export function shouldShareSpec(rest: readonly string[]): boolean {
  return rest.includes("--share-spec");
}

// A terminal meta route status takes priority because the pipeline already handled the proposal.
// approved is authorized but unexecuted, while rolled-back is retryable; neither is terminal here.
export function isProposalRouteTerminalStatus(metaStatus: unknown, artifactStatus: string): boolean {
  return (typeof metaStatus === "string" && PROPOSAL_ROUTE_TERMINAL_STATUSES.has(metaStatus))
    || PROPOSAL_ARTIFACT_TERMINAL_STATUSES.has(artifactStatus);
}

function isProposalRouteTerminal(artifact: { status: string; meta: Record<string, unknown> }): boolean {
  return isProposalRouteTerminalStatus(artifact.meta?.status, artifact.status);
}

async function sweepProposalBacklog(repoRoot: string, feedbackDir: string): Promise<{ enqueued: number; rejected: number; human: number }> {
  const artifactStore = new ArtifactStore(join(repoRoot, ".kunpeng", "artifacts"));
  const feedbackStore = new ReinjectStore(feedbackDir);
  return sweepProposals({
    listPending: async () => (await artifactStore.list("proposal"))
      .filter((artifact) => !isProposalRouteTerminal(artifact))
      .map(pendingFromArtifact),
    enqueue: async (requirement) => {
      await feedbackStore.enqueue([{
        fingerprint: stableHash(`proposal:auto|${requirement}`),
        requirement,
        source: "proposal:auto",
        severity: "error",
      }], Date.now());
    },
    mark: (id, status, reason) => markProposalRoute(artifactStore, id, status, reason),
  });
}

registerCliCommand({
  name: "best-of-n",
  run: async (context: CliContext) => {
    // 方向3：同一 spec 并行跑 N 个候选实现，按 execution（真过验收+最快）选最优。
    const specPath = context.rest.find((a) => !a.startsWith("--"));
    const nIdx = context.rest.indexOf("--n");
    const n = nIdx >= 0 ? Math.max(2, parseInt(context.rest[nIdx + 1] ?? "2", 10) || 2) : 2;
    if (!specPath) { console.error("用法: kunpeng best-of-n <spec.md> --n <N> [--repo <仓库>]"); process.exit(1); return; }
    const md = await readFile(resolve(specPath), "utf8");
    const model = parseMethodPlan(md);
    const flow0 = model.phases[0]?.flows[0];
    if (!flow0?.acceptanceCmd) { console.error("[best-of-n] spec 第一流缺 acceptanceCmd（accept 块）"); process.exit(2); return; }
    const { store, ws, runner, tracker, checks, projectRules } = await createContext(context.repoRoot, context.kunpengHome);
    const planId = `bon-${Date.now().toString(36)}`;
    const shareSpec = shouldShareSpec(context.rest);
    console.log(shareSpec
      ? `[best-of-n] 并行 ${n} 候选实现同一 spec（共享 1 份 spec，省 (N-1)× spec token，但 N 候选使用同一份 spec），按 execution 选最优（后端 ${runner.backend}）`
      : `[best-of-n] 并行 ${n} 候选实现同一需求（每候选各跑自己的 spec，保留多样性），按 execution 选最优（后端 ${runner.backend}）`);
    // 共享模式省 token：spec 只跑一次（专用 worktree，跑完即丢，只留文本），注入给全部 N 候选的 DevCycle（precomputedSpec → 跳过各自 spec）。
    let specTokens = 0;
    const result = await runBestOfN({
      n,
      ...(shouldShareSpec(context.rest) ? {
        runSpecOnce: async () => {
          const specFlowId = `${planId}-spec`;
          const specFlow = await ws.acquire(specFlowId, "main");
          try {
            const specRes = await runner.run({ stage: "spec", system: projectRules ?? "", input: flow0.requirement, tools: [], cwd: specFlow.path });
            const tk = (specRes.meta as { tokens?: unknown }).tokens;
            if (typeof tk === "number" && tk > 0) specTokens = tk;
            return { text: specRes.text, meta: specRes.meta };
          } finally {
            await ws.rollback(specFlowId); // spec worktree 不留存，释放锁+删临时分支
          }
        },
      } : {}),
      runCandidate: async (i, sharedSpec) => {
        const flowId = `${planId}-c${i}`;
        const dc = new DevCycle({ store, ws, runner, tracker, flowId, acceptanceCmd: flow0.acceptanceCmd, checks, projectRules, base: "main", planContext: { planId, phase: i }, precomputedSpec: sharedSpec });
        const t0 = Date.now();
        const res = await dc.run(flow0.requirement);
        const candidate = { id: flowId, passed: res.status === "verified", ms: Date.now() - t0 };
        try {
          const st = await tracker.read(flowId);
          if (typeof st?.tokensUsed === "number" && Number.isFinite(st.tokensUsed) && st.tokensUsed > 0) {
            return { ...candidate, cost: st.tokensUsed };
          }
        } catch {
          // 状态读取失败不影响候选参与选优，按缺失 cost 处理。
        }
        return candidate;
      },
    });
    if (!result.winner) { console.log(`[best-of-n] ${result.reason}`); process.exit(2); return; }
    console.log(`[best-of-n] 赢家 ${result.winner.id}（${result.reason}）`);
    console.log(`  排名: ${result.ranking.map((c) => `${c.id}:${c.passed ? "✓" : "✗"}/${c.ms}ms`).join(" > ")}`);
    if (shareSpec) {
      console.log(specTokens > 0
        ? `  省 token：spec 只跑 1 次而非 ${n} 次 → 省约 ${(n - 1) * specTokens} token（spec 单次 ${specTokens}）`
        : `  省 token：spec 只跑 1 次而非 ${n} 次（共享 spec），省 (${n}-1)× spec 阶段开销`);
    }
    console.log(`  赢家分支 kp/${result.winner.id} 已验证——去总控台合并主干（人工门 #1）；落选分支可 kunpeng guardian-report 清理。`);
    return;
  },
});

registerCliCommand({
  name: "reinject",
  run: async (context: CliContext) => {
    const store = new ReinjectStore(join(context.repoRoot, ".kunpeng", "feedback"));
    if (context.flags.has("--list") || context.rest.includes("--list")) {
      const pending = await store.pending();
      console.log(`[飞轮] 待办 ${pending.length} 条：`);
      for (const e of pending.slice(0, 30)) console.log(`  - [${e.severity}] ${e.requirement}`);
      return;
    }
    if (context.rest.includes("--drive")) {
      const maxIdx = context.rest.indexOf("--max");
      const max = maxIdx >= 0 && context.rest[maxIdx + 1] !== undefined ? Number(context.rest[maxIdx + 1]) : undefined;
      const ctx = await createContext(context.repoRoot, context.kunpengHome);
      const fl = resolveFlowLog(context.repoRoot, "loop");
      if (fl.minted) teeConsoleToFile(fl.logPath);
      const detectedDrive = await detectChecks(context.repoRoot);
      const report = await runBacklogDriver({
        store,
        now: Date.now,
        max: max !== undefined && Number.isFinite(max) ? max : undefined,
        runOne: async (requirement, entry) => {
          const flowId = makeFlowId(requirement, Date.now());
          const dc = new DevCycle({
            store: ctx.store,
            ws: ctx.ws,
            runner: ctx.runner,
            flowId,
            tracker: ctx.tracker,
            checks: ctx.checks,
            projectRules: ctx.projectRules,
            acceptanceCmd: context.acceptArg ?? acceptanceCmdForSource(entry.source, detectedDrive),
            logPath: fl.logPath,
            maxRepairAttempts: 2,
            adaptiveTopology: context.flags.has("--adaptive"),
          });
          console.log(`[飞轮·驱动] 取需求 → flow ${flowId}：${requirement.slice(0, 60)}`);
          return dc.run(requirement);
        },
      });
      console.log(`[飞轮·驱动] 本轮处理 ${report.picked} 条 → 消费(verified) ${report.consumed}、未过 ${report.failed}；剩余待办 ${(await store.pending()).length}`);
      for (const o of report.outcomes) console.log(`  ${o.consumed ? "✓" : "✗"} [${o.status}] ${o.requirement.slice(0, 60)}`);
      await writeBoard(context.repoRoot).catch(() => {});
      return;
    }
    // 跑守护扫描当输入源（复用 guard 的扫描器装配）
    const detected = await detectChecks(context.repoRoot);
    const scanners = [...DEFAULT_SCANNERS];
    if (detected.typecheck) scanners.push({ name: "typecheck", severity: "error", cmd: detected.typecheck });
    if (detected.lint) scanners.push({ name: "lint", severity: "warn", cmd: detected.lint });
    const findings = await runGuardian(context.repoRoot, scanners);
    const report = await runReinjectScan({ findings, store, now: Date.now() });
    console.log(`[飞轮] 守护发现 ${report.scanned} 条 → 新入队 ${report.added.length}、去重跳过 ${report.skipped.length}、当前待办 ${report.pending}`);
    console.log(`  下一步：人工/驱动器从 backlog 取需求喂 kunpeng run。backlog 目录 .kunpeng/feedback`);
    return;
  },
});

registerCliCommand({
  name: "flywheel",
  run: async (context: CliContext) => {
    // 飞轮自转：守护扫描入队 → 活锁忙则跳过 → backlog 驱动真实 DevCycle。
    // --install/--uninstall/--print-cron 管 OS 级调度（--install 是唯一系统副作用，显式触发）。
    const cliPath = cliJsPath();
    const workingDir = resolve(dirname(cliPath), "..");  // orchestrator/（node_modules 所在）
    const cliJs = join(workingDir, "dist", "cli.js");
    const projectId =
      (await readProjectSelf(context.repoRoot))?.id ??
      (await readRegistry(kunpengStateDir())).find((p) => p.repoPath === context.repoRoot)?.id ??
      "default";
    const label = `com.kunpeng.flywheel.${projectId}`;

    if (context.flags.has("--print-cron")) {
      const minutes = context.intervalArg ? Math.max(1, Math.round(Number(context.intervalArg) / 60)) : 60;
      console.log(renderCrontabLine({ intervalMinutes: minutes, command: `${process.execPath} ${cliJs} flywheel --repo ${context.repoRoot}` }));
      return;
    }
    if (context.flags.has("--uninstall")) {
      try {
        const r = await uninstallDaemonSchedule(label, daemonPlatform(), realDaemonIo());
        console.log(`[飞轮·自转] 已卸载定时调度：${r.removed.join(", ")}`);
      } catch (error) {
        console.error(`[飞轮·自转] 卸载定时调度失败：${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
      return;
    }
    if (context.flags.has("--install")) {
      const intervalSeconds = context.intervalArg ? Math.max(60, Number(context.intervalArg)) : 3600;
      // --max（每轮至多驱动几条真 DevCycle，额度阀，缺省 1）
      const maxIdxI = context.rest.indexOf("--max");
      const maxArg = maxIdxI >= 0 && context.rest[maxIdxI + 1] !== undefined ? context.rest[maxIdxI + 1] : "1";
      const installArgs = [cliJs, "flywheel", "--repo", context.repoRoot, "--max", maxArg];
      if (context.flags.has("--adaptive")) installArgs.push("--adaptive");
      // launchd 极简环境必须显式注入认证所需 env（否则后端找不到/未登录 → drive 空转回滚）：
      //  PATH(含 codex/claude 二进制目录) + HOME(读 ~/.codex/~/.claude) + USER/LOGNAME(claude 走 Keychain 按用户身份取凭证，缺则"Not logged in") + SHELL。
      //  --mixed：不强制后端 → 按 STAGE_BACKEND 混合路由(spec/audit/review/verify/design=claude，implement=codex)；否则强制 KUNPENG_BACKEND(缺省 codex)。
      const mixed = context.flags.has("--mixed");
      const backend = process.env.KUNPENG_BACKEND ?? "codex";
      const env: Record<string, string> = {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        HOME: process.env.HOME ?? homedir(),
        ...(process.env.USER ? { USER: process.env.USER } : {}),
        ...(process.env.LOGNAME ? { LOGNAME: process.env.LOGNAME } : {}),
        ...(process.env.SHELL ? { SHELL: process.env.SHELL } : {}),
      };
      if (!mixed) env.KUNPENG_BACKEND = backend; // 混合模式不设 → CliRunner.forced=undefined → 走 STAGE_BACKEND
      const spec = { label, binPath: process.execPath, args: installArgs, intervalSeconds, workingDir, env };
      try {
        const r = await installDaemonSchedule(spec, daemonPlatform(), realDaemonIo());
        console.log(`[飞轮·自转] 已安装定时调度（唯一系统副作用，显式 --install）：`);
        console.log(`  调度文件:  ${r.paths.join(", ")}`);
        console.log(`  间隔:   每 ${intervalSeconds}s 跑一次 flywheel --max ${maxArg}${context.flags.has("--adaptive") ? " --adaptive" : ""} --repo ${context.repoRoot}`);
        console.log(`  后端:   ${mixed ? "混合路由(spec/audit/review/verify=claude，implement=codex)" : `KUNPENG_BACKEND=${backend}`}（已注入 PATH/HOME/USER/LOGNAME 供 codex+claude 认证）`);
        console.log(`  卸载:   kunpeng flywheel --repo ${context.repoRoot} --uninstall`);
      } catch (error) {
        console.error(`[飞轮·自转] 安装定时调度失败：${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
      return;
    }

    const ctx = await createContext(context.repoRoot, context.kunpengHome);
    const noScan = context.rest.includes("--no-scan");
    const maxIdx = context.rest.indexOf("--max");
    const maxRaw = maxIdx >= 0 && context.rest[maxIdx + 1] !== undefined ? Number(context.rest[maxIdx + 1]) : 1;
    const max = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : 1;
    const feedbackDir = join(context.repoRoot, ".kunpeng", "feedback");
    const fl = resolveFlowLog(context.repoRoot, "loop");
    if (fl.minted) teeConsoleToFile(fl.logPath);
    // 自转 drive 也按 backlog 项来源派生验收命令(lint→detected.lint 等),与 --drive 路一致;
    // 否则 lint 类 backlog 项 acceptanceCmd 为空 → 审计门 fail-closed 空转(85/98 历史失败根因)。
    const detectedDrive = await detectChecks(context.repoRoot);
    const report = await runFlywheelRound({
      scan: async () => {
        const proposalReport = await sweepProposalBacklog(context.repoRoot, feedbackDir);
        console.log(`[提案管道] 入队 ${proposalReport.enqueued} · 驳回 ${proposalReport.rejected} · 留人工 ${proposalReport.human}`);
        if (noScan) return { added: [], pending: (await new ReinjectStore(feedbackDir).pending()).length };
        const detected = await detectChecks(context.repoRoot);
        const scanners = [...DEFAULT_SCANNERS];
        if (detected.typecheck) scanners.push({ name: "typecheck", severity: "error", cmd: detected.typecheck });
        if (detected.lint) scanners.push({ name: "lint", severity: "warn", cmd: detected.lint });
        const findings = await runGuardian(context.repoRoot, scanners);
        const r = await runReinjectScan({ findings, store: new ReinjectStore(feedbackDir), now: Date.now() });
        return { added: r.added, pending: r.pending };
      },
      activeLocks: () => countActiveLocks(join(context.repoRoot, ".kunpeng", "locks")),
      drive: () => runBacklogDriver({
        store: new ReinjectStore(feedbackDir),
        now: Date.now,
        max,
        stopOnFail: true,
        runOne: async (requirement, entry) => {
          const flowId = makeFlowId(requirement, Date.now());
          const dc = new DevCycle({
            store: ctx.store,
            ws: ctx.ws,
            runner: ctx.runner,
            flowId,
            tracker: ctx.tracker,
            checks: ctx.checks,
            projectRules: ctx.projectRules,
            acceptanceCmd: context.acceptArg ?? acceptanceCmdForSource(entry.source, detectedDrive),
            logPath: fl.logPath,
            maxRepairAttempts: 2,
            adaptiveTopology: context.flags.has("--adaptive"),
          });
          console.log(`[飞轮·自转] 取需求 → flow ${flowId}：${requirement.slice(0, 60)}`);
          return dc.run(requirement);
        },
      }),
    });
    if (report.scanned && !noScan) console.log(`[飞轮·自转] 守护扫描 → 新入队 ${report.scanned.added}、当前待办 ${report.scanned.pending}`);
    if (report.skipped === "busy") {
      console.log(`[飞轮·自转] 检测到别的流在跑(活锁)，本轮跳过驱动——不抢共享工作树。`);
    } else if (report.drive) {
      const d = report.drive;
      console.log(`[飞轮·自转] 驱动 ${d.picked} 条 → 消费(verified) ${d.consumed}、未过 ${d.failed}`);
      for (const o of d.outcomes) console.log(`  ${o.consumed ? "✓" : "✗"} [${o.status}] ${o.requirement.slice(0, 60)}`);
    }
    if (report.skipped !== "busy") {
      // busy 那轮不记账（没真正驱动，input/yield 无意义）。
      const d = report.drive;
      await recordAndWarn(context.repoRoot, {
        loop: "flywheel",
        project: basename(context.repoRoot),
        input: d?.picked ?? 0,
        yield: d?.consumed ?? 0,
        // 上游 = backlog 待办数：待办为 0 是闲置；待办有货却一直取不到才是饿死。
        ...(report.scanned ? { upstream: report.scanned.pending } : {}),
      });
    }
    await writeBoard(context.repoRoot).catch(() => {});
    return;
  },
});

registerCliCommand({
  name: "evolve",
  run: async (context: CliContext) => {
    const store = new ArtifactStore(join(context.repoRoot, ".kunpeng", "artifacts"));
    const experiences = await store.list("experience");
    const proposal = buildProposal(experiences);
    const id = `evolve-${Date.now().toString(36)}`;
    await persistProposal(store, id, proposal);
    console.log(`[自我进化] 消费 ${experiences.length} 条经验 → 提案 ${id}：拟改 ${proposal.changes.length} 条，拒 ${proposal.rejected.length} 条（命中core）`);
    console.log(`  ⚠ 仅提案，未应用——需人工门 #2 批准后手动应用到 conventions（core 不可改）。`);
    return;
  },
});

registerCliCommand({
  name: "evaluate",
  usage: EVALUATE_USAGE,
  run: async (context: CliContext) => {
    const id = context.rest[0];
    if (!id) {
      throw new CliUsageError(EVALUATE_USAGE);
    }
    const store = new ArtifactStore(join(context.repoRoot, ".kunpeng", "artifacts"));

    // --differential：在「基线规则 vs 候选规则（提案已应用）」两个 worktree 里让 agent 真做一遍 holdout，
    // 比通过率（C 方案：按需在人工门付费的真飞轮度量）。无 --differential 时走旧的静态最小版。
    if (context.rest.includes("--differential")) {
      const limIdx = context.rest.indexOf("--limit");
      const limit = limIdx >= 0 ? Math.max(1, parseInt(context.rest[limIdx + 1] ?? "1", 10) || 1) : 1;
      // --strip <file>：在两个 worktree 里删掉该实现文件（保留其测试=验收），让 agent 真重建——
      // 把"解扣住"，差分才测真本事，而非 main 上已存在的解被静态验收白白放行。
      const stripIdx = context.rest.indexOf("--strip");
      const stripFile = stripIdx >= 0 ? context.rest[stripIdx + 1] : undefined;
      const conventionsPath = join(context.kunpengHome, "constitution", "conventions.md");
      const baselineRules = await readFile(conventionsPath, "utf8").catch(() => "");
      const regression = new RegressionStore(join(context.repoRoot, ".kunpeng", "regression"));
      const runner = new CliRunner();
      const ws = new Workspace(context.repoRoot);
      const baseFlow = `eval-base-${id}`, candFlow = `eval-cand-${id}`;
      const result = await evaluateProposal(id, {
        store,
        loadProposalChanges: async (pid) => {
          try { return evolutionProposalFromArtifact(await store.read(pid)).changes; } catch { return null; }
        },
        listHoldout: async () => (await regression.list("holdout")).slice(0, limit),
        baselineRules,
        candidateRulesFor: (changes) => `${baselineRules}\n${changes.map((c) => `- ${c.text}`).join("\n")}`,
        prepareWorktrees: async (task0) => {
          const base = task0 ? holdoutRerunBase(task0) : "main";
          const bf = await ws.acquire(baseFlow, base);
          const cf = await ws.acquire(candFlow, base);
          if (stripFile) {
            await rm(join(bf.path, stripFile), { force: true }).catch(() => {});
            await rm(join(cf.path, stripFile), { force: true }).catch(() => {});
          }
          return {
            baselineCwd: bf.path, candidateCwd: cf.path,
            cleanup: async () => { await ws.rollback(baseFlow).catch(() => {}); await ws.rollback(candFlow).catch(() => {}); },
          };
        },
        runAttempt: async (task, rules, cwd) => {
          const t0 = Date.now();
          await runner.run({ stage: "implement", system: rules, input: task.requirement, tools: ["write", "edit", "bash"], cwd });
          const v = await runVerification({ cwd, cmd: task.acceptanceCmd, timeoutMs: 300_000 });
          return { passed: v.passed, ms: Date.now() - t0 };
        },
      });
      if (!result) { console.log(`[差分评测] proposal ${id} 不存在`); return; }
      const e = result.evidence;
      console.log(`[差分评测] proposal ${id} evidence 已写入（提案仍 draft，待人工门 #2）`);
      console.log(`  候选 holdoutPassK=${e.holdoutPassK} ｜ 基线 holdoutPassK=${e.baseline?.holdoutPassK} ｜ Δ=${(e.holdoutPassK - (e.baseline?.holdoutPassK ?? 0)).toFixed(3)} ｜ costPerResolvedTask=${e.costPerResolvedTask}`);
      const rep = result.report as { markdown?: string } | undefined;
      if (rep?.markdown) console.log(`\n${rep.markdown}`);
      return;
    }

    const evidence = await evaluateHoldoutReliability(buildEvalDeps(context.repoRoot));
    await attachEvidence(store, id, evidence);
    console.log(`[评测] proposal ${id} evidence 已写入`);
    console.log(`  holdoutPassK=${evidence.holdoutPassK} costPerResolvedTask=${evidence.costPerResolvedTask}`);
    return;
  },
});
