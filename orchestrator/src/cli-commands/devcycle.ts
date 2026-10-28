import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../artifacts/store.js";
import { extractAcceptance } from "../plan/acceptance.js";
import { formatLintReport, lintSpecText } from "../plan/spec-lint.js";
import { parseGoalId } from "../goals/parse.js";
import { GoalStore, goalsDir, isGoalId } from "../goals/store.js";
import { writeBoard } from "../board/write-board.js";
import { DevCycle } from "../loop/dev-cycle.js";
import { precheckDispatchOverlap } from "../loop/dispatch-overlap.js";
import { runGuardian, DEFAULT_SCANNERS } from "../loop/guardian.js";
import { detectChecks } from "../project/detect.js";
import { resolveFlowLog, teeConsoleToFile } from "../runtime/flow-log.js";
import { makeBudgetCheck, isBudgetBlocker } from "../runtime/budget-guard.js";
import { isRaiseBlocker } from "../runtime/raise-blocker.js";
import { loadRepoBudget } from "../runtime/flow-budget.js";
import { acquireFlowSlot, resolveMaxConcurrentFlows } from "../runtime/concurrency-slots.js";
import { runMergeCommand } from "../runtime/merge-gate.js";
import { resolveCliActor } from "../runtime/cli-actor.js";
import { postMergeBuild } from "../runtime/post-merge-build.js";
import { formatObserveWarn, gateModeFor, recordGateObservation } from "../runtime/gate-mode.js";
import { requestPause, clearPause, isPauseRequested } from "../runtime/pause-marker.js";
import { readFeedback, clearFeedback, formatFeedbackForPrompt } from "../runtime/review-feedback.js";
import { createContext } from "../sdk/context.js";
import { parseAuditFixables, buildFixPlan } from "../security/audit-fix.js";
import { parseAuditSummary, reductionOk, buildFixProvenance } from "../security/audit-fix-outcome.js";
import { installShieldHook } from "../security/install-shield-hook.js";
import { makeFlowId } from "../util/flow-id.js";
import { detectScopeDrift, parseScopeDeclaration, type ScopeViolation } from "../verify/scope-gate.js";
import { resolveRequireScope } from "../verify/scope-main-gate.js";
import { resolveRedFirst } from "../verify/red-first.js";
import { registerCliCommand, type CliContext } from "./registry.js";
import { fileSwitchboardSender } from "../switchboard/default-sender.js";

const RUN_USAGE = "用法: kunpeng run \"<需求>\"";

/** 显式 --accept 优先，其次使用作者在需求中声明的验收命令。 */
export function resolveRunAcceptance(acceptArg: string | undefined, requirement: string): string | undefined {
  if (acceptArg?.trim()) return acceptArg;
  return extractAcceptance(requirement) ?? undefined;
}

export type ScopeCheckResult = {
  /** observed = 判定越界但范围门处于 observe 模式:只记账、放行(exitCode 0)。 */
  status: "skipped" | "passed" | "failed" | "error" | "observed";
  exitCode: 0 | 1 | 2;
  changedFiles: string[];
  violations: ScopeViolation[];
  messages: string[];
};

export async function runScopeCheck(specText: string, repoRoot: string, flowId: string): Promise<ScopeCheckResult> {
  const scope = parseScopeDeclaration(specText);
  if (!scope) {
    return {
      status: "skipped",
      exitCode: 0,
      changedFiles: [],
      violations: [],
      messages: ["该 spec 未声明 ```scope 范围，跳过范围门"],
    };
  }

  let rawChanged: string;
  try {
    rawChanged = await simpleGit(repoRoot).raw(["diff", "--no-renames", "--name-only", `main...kp/${flowId}`]);
  } catch (error) {
    return {
      status: "error",
      exitCode: 1,
      changedFiles: [],
      violations: [],
      messages: [`范围门无法读取流 diff（确认仓库、main 与 kp/${flowId} 是否存在）：${(error as Error).message}`],
    };
  }

  const changedFiles = rawChanged.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const result = detectScopeDrift(changedFiles, scope);
  if (result.ok) {
    return {
      status: "passed",
      exitCode: 0,
      changedFiles,
      violations: [],
      messages: [`范围门通过：${changedFiles.length} 个改动文件均在声明范围内`],
    };
  }

  // 范围门接缝:判定"应拦"→ 先记观察账本;observe 模式只 warn 放行,block 模式与现状完全一致。
  const reason = result.violations.map((v) => `${v.file}（${v.rule}）`).join(", ");
  const mode = gateModeFor("scope", repoRoot);
  recordGateObservation(repoRoot, { gate: "scope", flowId, wouldBlock: true, reason, at: Date.now(), mode });
  if (mode === "observe") {
    return {
      status: "observed",
      exitCode: 0,
      changedFiles,
      violations: result.violations,
      messages: [formatObserveWarn("scope", reason)],
    };
  }

  return {
    status: "failed",
    exitCode: 2,
    changedFiles,
    violations: result.violations,
    messages: result.violations.map((v) => `[范围越界] ${v.file}（${v.rule}）`),
  };
}

/**
 * 把 run 命令的原始参数解析成真正的需求文本。
 * 当参数看起来是一个单一 spec 文件路径（不含换行、以 .md/.spec.md 结尾，大小写不敏感）且文件存在可读时，
 * 读成文件内容并记录来源；否则一律原样返回，保留「需求就是一句话」的既有用法。
 * 读盘失败/内容全空白一律降级为原样字符串，绝不抛异常。
 */
export function resolveRequirementInput(
  raw: string,
  deps: { exists: (path: string) => boolean; read: (path: string) => string },
): { requirement: string; sourcePath?: string } {
  const rawTrimmed = raw.trim();
  if (!rawTrimmed) return { requirement: "" };

  const looksLikeSpecPath = !/[\r\n]/.test(rawTrimmed) && /\.(?:spec\.)?md$/i.test(rawTrimmed);
  if (!looksLikeSpecPath) return { requirement: rawTrimmed };

  if (!deps.exists(rawTrimmed)) return { requirement: rawTrimmed };

  let content: string;
  try {
    content = deps.read(rawTrimmed);
  } catch {
    return { requirement: rawTrimmed };
  }
  if (!content || !content.trim()) return { requirement: rawTrimmed };
  return { requirement: content, sourcePath: rawTrimmed };
}

/** 按 repoRoot、cwd 顺序定位可读且非空白的 spec，供 run 在创建上下文前检查。 */
export function locateSpecInput(
  raw: string,
  deps: { exists: (p: string) => boolean; read: (p: string) => string; repoRoot: string; cwd: string },
): { kind: "text" } | { kind: "file"; path: string } | { kind: "missing"; tried: string[] } {
  const looksLikeSpecPath = !/[\r\n]/.test(raw) && /\.(?:spec\.)?md$/i.test(raw);
  if (!looksLikeSpecPath) return { kind: "text" };

  const tried = isAbsolute(raw) ? [raw] : [...new Set([join(deps.repoRoot, raw), join(deps.cwd, raw)])];
  for (const path of tried) {
    if (!deps.exists(path)) continue;
    try {
      if (deps.read(path).trim()) return { kind: "file", path };
    } catch {
      // 当前候选不可读，继续尝试下一处；全部不可用时由调用方显式报错。
      continue;
    }
  }
  return { kind: "missing", tried };
}

/** run 派 spec 文件前的确定性闸：与 plan 同一套 spec-lint；命令行已给 --accept 时不追究 spec 里缺 accept 块。 */
export function preDispatchLint(
  specText: string,
  repoRoot: string,
  opts: { acceptArgGiven: boolean },
): { blocked: boolean; report: string } {
  const issues = lintSpecText(specText, repoRoot)
    .filter((item) => !(opts.acceptArgGiven && item.code === "accept-missing"));
  return {
    blocked: issues.some((item) => item.level === "error"),
    report: issues.length > 0 ? formatLintReport(issues) : "",
  };
}

export function isPlanMergeGateLabel(requirement: string): boolean {
  return /^方案集成\s+plan-[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(requirement.trim());
}

export function scopeAllowFromRequirement(requirement: string): string[] | undefined {
  try {
    const decl = parseScopeDeclaration(requirement);
    return decl?.allow.length ? decl.allow : undefined;
  } catch {
    return undefined;
  }
}

registerCliCommand({
  name: "run",
  usage: RUN_USAGE,
  run: async (context: CliContext) => {
    const rawInput = context.rest.join(" ");
    const specInput = locateSpecInput(rawInput.trim(), {
      exists: existsSync, read: (p) => readFileSync(p, "utf8"), repoRoot: context.repoRoot, cwd: process.cwd(),
    });
    if (specInput.kind === "missing") {
      console.error(`读不到 spec 文件：${specInput.tried.join("、")}`);
      process.exit(1);
    }
    const { requirement } = resolveRequirementInput(specInput.kind === "file" ? specInput.path : rawInput, {
      exists: existsSync, read: (p) => readFileSync(p, "utf8"),
    });
    if (!requirement) { console.error(RUN_USAGE); process.exit(1); }
    if (specInput.kind === "file") {
      const lint = preDispatchLint(requirement, context.repoRoot, { acceptArgGiven: Boolean(context.acceptArg) });
      if (lint.blocked) {
        console.error(`派流前 spec 校验未通过（${specInput.path}）：\n${lint.report}`);
        process.exit(2);
      }
      if (lint.report) console.warn(lint.report);
    }
    if (isPlanMergeGateLabel(requirement)) {
      console.error("这是某条已完成 plan 的『合并主干』人工门标签（见 plan/orchestrator.ts），不是可实现的需求；合并主干走 `kunpeng merge`，勿当需求重派");
      process.exit(1);
    }
    // flowId 仍由原始参数派生（不用文件内容），保住可读的历史流 id 规则。
    const flowId = makeFlowId(rawInput.trim(), Date.now());
    const scopeAllow = scopeAllowFromRequirement(requirement);
    const { store, ws, runner, tracker, checks, projectRules } = await createContext(context.repoRoot, context.kunpengHome);
    const fl = resolveFlowLog(context.repoRoot, "run");
    if (fl.minted) teeConsoleToFile(fl.logPath);
    const goalId = context.goalArg ?? parseGoalId(requirement);
    if (goalId !== undefined && !isGoalId(goalId)) {
      console.error(`[goal] 非法目标 id：${goalId}`);
      process.exit(1);
    }
    if (goalId && await new GoalStore(goalsDir(join(context.repoRoot, ".kunpeng"))).read(goalId) === null) {
      console.warn(`[goal] 未登记的目标 ${goalId}，仍按此 id 归属；用 kunpeng goal add 登记`);
    }
    // 派流预检:预测本流触及文件集,与在跑流撞文件时告警(KUNPENG_OVERLAP_STRICT=1 则 exit 4 拒派);预测集随 start 落盘供后来者比对。
    const precheck = await precheckDispatchOverlap({ flowId, requirement, scopeAllow, tracker, repoRoot: context.repoRoot });
    const dc = new DevCycle({
      store, ws, runner, flowId, tracker, checks, projectRules, acceptanceCmd: resolveRunAcceptance(context.acceptArg, requirement),
      ...(goalId ? { goalId } : {}),
      switchboard: fileSwitchboardSender(),
      budgetCheck: makeBudgetCheck({ repoRoot: context.repoRoot, tracker, env: process.env }),
      acquireSlot: () => acquireFlowSlot(join(context.repoRoot, ".kunpeng"), {
        max: resolveMaxConcurrentFlows(process.env, loadRepoBudget(join(context.repoRoot, ".kunpeng"))),
      }),
      requireScope: resolveRequireScope(process.env),
      redFirst: resolveRedFirst(process.env),
      ...(scopeAllow ? { scopeAllow } : {}),
      ...(precheck.predictedFiles.length ? { predictedFiles: precheck.predictedFiles } : {}),
      logPath: fl.logPath, maxRepairAttempts: 2,
      adaptiveTopology: context.flags.has("--adaptive"),
    });
    console.log(`[接线员] 目标仓库 ${context.repoRoot} ｜ 受理需求 → flow ${flowId}（后端 ${runner.backend}${checks.length ? `，验证含 ${checks.join(" + ")}` : ""}） ｜ 目标 ${goalId ?? "未归属"}`);
    const result = await dc.run(requirement);
    console.log(`[结果] ${result.status}`);
    if (result.evidence) console.log(`[证据]\n${result.evidence}`);
    await writeBoard(context.repoRoot).catch(() => {}); // #3 自动刷新跨端看板
    process.exit(result.status === "verified" ? 0 : 2);
  },
});

registerCliCommand({
  name: "pause",
  run: async (context: CliContext) => {
    // S2 切片6:请求暂停一个运行中的流——写 pause 标记,运行中的流在下个阶段边界(implement 后,checkpoint 已存)优雅停,
    // 之后 kunpeng resume <flowId> 从 checkpoint 续跑。
    const flowId = context.rest[0];
    if (!flowId) { console.error("用法: kunpeng pause <flowId> [--repo <仓库>]"); process.exit(1); }
    await requestPause(context.repoRoot, flowId);
    console.log(`[pause] 已请求暂停 flow ${flowId}：它会在下一个阶段边界停下（checkpoint 已存）。用 kunpeng resume ${flowId} 续跑。`);
    return;
  },
});

registerCliCommand({
  name: "resume",
  run: async (context: CliContext) => {
    const flowId = context.rest[0];
    if (!flowId) { console.error("用法: kunpeng resume <flowId> [--repo <仓库>]"); process.exit(1); }
    const { store, ws, runner, tracker, checks, projectRules } = await createContext(context.repoRoot, context.kunpengHome);
    const state = await tracker.read(flowId);
    if (!state) { console.error(`[resume] 未知流: ${flowId}`); process.exit(1); }
    await clearPause(context.repoRoot, flowId);   // S2 切片6:续跑前清掉 pause 标记,否则立即又停在边界。
    if (isBudgetBlocker(state.blocker) || isRaiseBlocker(state.blocker)) {
      await tracker.clearBlocker(flowId);
      console.log(isBudgetBlocker(state.blocker)
        ? "[resume] 已清除超预算卡点，以当前用量为新基线续跑"
        : "[resume] 已清除求助卡点");
    }
    // #6 回灌:续跑前读人工审查意见,拼成 prompt 注入 implement;跑完清掉(避免下次重复注入)。
    const feedback = formatFeedbackForPrompt(await readFeedback(context.repoRoot, flowId));
    if (isRaiseBlocker(state.blocker) && !feedback) console.log("[resume] 尚未回复求助，将继续续跑");
    if (feedback) console.log(`[回灌] 注入人工审查意见,将重跑 implement 据此修正。`);
    const fl = resolveFlowLog(context.repoRoot, "resume");
    if (fl.minted) teeConsoleToFile(fl.logPath);
    const dc = new DevCycle({
      store, ws, runner, tracker, flowId, resume: true, base: "main",
      switchboard: fileSwitchboardSender(),
      budgetCheck: makeBudgetCheck({ repoRoot: context.repoRoot, tracker, env: process.env, baselineFlowId: flowId }),
      acquireSlot: () => acquireFlowSlot(join(context.repoRoot, ".kunpeng"), {
        max: resolveMaxConcurrentFlows(process.env, loadRepoBudget(join(context.repoRoot, ".kunpeng"))),
      }),
      checks, projectRules, logPath: fl.logPath, maxRepairAttempts: 2,
      checkpointStages: true, onCheckpoint: async () => isPauseRequested(context.repoRoot, flowId),
      ...(feedback ? { reviewFeedback: feedback } : {}),
    });
    console.log(`[接线员] 目标仓库 ${context.repoRoot} ｜ 续跑 flow ${flowId}（后端 ${runner.backend}${checks.length ? `，验证含 ${checks.join(" + ")}` : ""}）`);
    const result = await dc.run(state.requirement);
    if (feedback) await clearFeedback(context.repoRoot, flowId);   // 回灌已消费,清掉
    console.log(`[结果] ${result.status}`);
    if (result.evidence) console.log(`[证据]\n${result.evidence}`);
    await writeBoard(context.repoRoot).catch(() => {});
    process.exit(result.status === "verified" ? 0 : 2);
  },
});

registerCliCommand({
  name: "guard",
  run: async (context: CliContext) => {
    // 守护用目标项目的真实检查当扫描器：typecheck(error)/lint(warn)，外加 TODO 扫描。
    const detected = await detectChecks(context.repoRoot);
    const scanners = [...DEFAULT_SCANNERS];
    if (detected.typecheck) scanners.push({ name: "typecheck", severity: "error", cmd: detected.typecheck });
    if (detected.lint) scanners.push({ name: "lint", severity: "warn", cmd: detected.lint });
    const findings = await runGuardian(context.repoRoot, scanners);
    const store = new ArtifactStore(join(context.repoRoot, ".kunpeng", "artifacts"));
    const id = `guard-${Date.now().toString(36)}`;
    const body = findings.length
      ? findings.map((f) => `- [${f.severity}] ${f.file ?? ""}:${f.line ?? ""} ${f.message}`).join("\n")
      : "(no findings)";
    await store.write({ kind: "review", id, status: "draft", body, meta: { findings } });
    console.log(`[守护] 扫描完成，${findings.length} 条发现 → review ${id}`);
    for (const f of findings.slice(0, 20)) console.log(`  [${f.severity}] ${f.file ?? ""}:${f.line ?? ""} ${f.message}`);
    return;
  },
});

registerCliCommand({
  name: "install-hooks",
  run: async (context: CliContext) => {
    const destIndex = context.rest.indexOf("--dest");
    const destDir = destIndex >= 0 ? context.rest[destIndex + 1] : join(homedir(), ".kunpeng", "hooks");
    if (!destDir || (destIndex >= 0 && destDir.startsWith("--"))) {
      console.error("用法: kunpeng install-hooks [--dest <dir>]");
      process.exit(1);
    }
    const written = await installShieldHook(destDir);
    console.log(written);
  },
});

registerCliCommand({
  name: "audit",
  run: async (context: CliContext) => {
    // S5 漏洞闭环·扫描+(可选)自动修复。npm 项目目录:repoRoot 有 package.json 用它,否则 repoRoot/orchestrator,
    // 否则 repoRoot——避免无 package.json 时 npm 向上走审计到 HOME 的无关依赖。
    const npmDir = existsSync(join(context.repoRoot, "package.json")) ? context.repoRoot
      : existsSync(join(context.repoRoot, "orchestrator", "package.json")) ? join(context.repoRoot, "orchestrator")
      : context.repoRoot;
    const runAudit = (dir: string): string => {
      try { return execFileSync("npm", ["audit", "--json"], { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 180_000 }); }
      catch (e) { return String((e as { stdout?: string }).stdout ?? ""); }
    };
    const auditJson = runAudit(npmDir);
    const plan = buildFixPlan(parseAuditFixables(auditJson));
    if (plan.total === 0) { console.log(`[漏洞] ${npmDir} npm audit 无漏洞条目（或无法解析）。`); return; }
    const sev = Object.entries(plan.bySeverity).map(([k, v]) => `${k} ${v}`).join(" · ");
    console.log(`[漏洞] ${npmDir} 共 ${plan.total} 条（${sev}）`);
    console.log(`  ✅ 可安全自动修(非破坏性) ${plan.safeAuto.length}：${plan.safeAuto.map((f) => f.pkg).join(", ") || "—"}`);
    console.log(`  ⚠️  需人审(semver-major 升级) ${plan.majorReview.length}：${plan.majorReview.map((f) => `${f.pkg}→${f.fixName}@${f.fixVersion}`).join(", ") || "—"}`);
    console.log(`  ✗ 暂无修复 ${plan.unfixable.length}：${plan.unfixable.map((f) => f.pkg).join(", ") || "—"}`);

    if (!context.flags.has("--fix")) {
      if (plan.safeAuto.length) console.log(`  下一步:kunpeng audit --fix --repo ${context.repoRoot} 自动修「可安全自动修」并真验证(隔离 worktree+install+typecheck)再合并。`);
      return;
    }
    // ── --fix:在隔离 worktree(无工具链软链)里 fresh install → npm audit fix(非破坏性) → 重审 + typecheck 验证 →
    //    只把 package.json+package-lock.json 的改动收割回主仓 + 写 provenance。主仓在验证通过前绝不动。 ──
    if (plan.safeAuto.length === 0) { console.log("  无「可安全自动修」项,跳过 --fix。"); return; }
    const before = parseAuditSummary(auditJson);
    const tmp = join(context.repoRoot, ".kunpeng", "audit-fix-wt");
    const relNpmDir = npmDir === context.repoRoot ? "." : npmDir.slice(context.repoRoot.length + 1);
    try {
      execFileSync("git", ["worktree", "remove", "--force", tmp], { cwd: context.repoRoot, stdio: "pipe", timeout: 60_000 });
    } catch { /* 不存在,忽略 */ }
    try {
      console.log(`  [fix] 建隔离 worktree(off main,无软链): ${tmp}`);
      execFileSync("git", ["worktree", "add", "--detach", tmp, "main"], { cwd: context.repoRoot, stdio: "pipe", timeout: 60_000 });
      const wtNpm = join(tmp, relNpmDir);
      console.log(`  [fix] fresh npm install（可能数分钟）…`);
      execFileSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: wtNpm, stdio: "pipe", maxBuffer: 256 * 1024 * 1024, timeout: 600_000 });
      console.log(`  [fix] npm audit fix（仅非破坏性）…`);
      try { execFileSync("npm", ["audit", "fix", "--no-audit", "--no-fund"], { cwd: wtNpm, stdio: "pipe", maxBuffer: 256 * 1024 * 1024, timeout: 180_000 }); } catch { /* audit fix 可能非0退出 */ }
      const after = parseAuditSummary(runAudit(wtNpm));
      console.log(`  [fix] 修复前后:total ${before.total}→${after.total}（critical ${before.critical}→${after.critical} · high ${before.high}→${after.high}）`);
      let verified = false;
      const detected = await detectChecks(wtNpm);
      if (detected.typecheck) {
        console.log(`  [fix] 真验证 typecheck: ${detected.typecheck}`);
        try { execFileSync(detected.typecheck.split(" ")[0], detected.typecheck.split(" ").slice(1), { cwd: wtNpm, stdio: "pipe", maxBuffer: 64 * 1024 * 1024, timeout: 300_000 }); verified = true; }
        catch { verified = false; }
      } else { verified = true; /* 无 typecheck 命令则只看漏洞下降 */ }
      const ok = reductionOk(before, after) && verified;
      console.log(`  [fix] 漏洞下降=${reductionOk(before, after)} typecheck过=${verified} → ${ok ? "接受" : "拒绝(主仓不动)"}`);
      if (ok) {
        // 收割 package.json + package-lock.json 回主仓 npm 目录
        for (const f of ["package.json", "package-lock.json"]) {
          const src = join(wtNpm, f);
          if (existsSync(src)) execFileSync("cp", [src, join(npmDir, f)], { timeout: 60_000 });
        }
        const prov = buildFixProvenance({ before, after, fixedPackages: plan.safeAuto.map((x) => x.pkg), verified, fixedAt: Date.now() });
        const store = new ArtifactStore(join(context.repoRoot, ".kunpeng", "artifacts"));
        const id = `secfix-${Date.now().toString(36)}`;
        await store.write({ kind: "experience", id, status: "draft", body: `安全自动修:漏洞 ${before.total}→${after.total}`, meta: { provenance: prov } });
        console.log(`  ✅ [fix] 已收割 package.json/lock 回主仓 + provenance ${id}。请 review 后 git add 这两文件提交(主仓 node_modules 需 npm install 同步)。`);
        console.log(`     ⚠️ 注意:只改了 manifest/lock,未动主仓 node_modules——下次 install/CI 会装上修复版本。`);
      } else {
        console.log(`  ✗ [fix] 未通过,主仓未改动。`);
      }
    } catch (e) {
      console.log(`  ✗ [fix] 出错(主仓未改动): ${String(e).slice(0, 200)}`);
    } finally {
      try { execFileSync("git", ["worktree", "remove", "--force", tmp], { cwd: context.repoRoot, timeout: 60_000 }); } catch { /* ignore */ }
    }
    return;
  },
});

registerCliCommand({
  name: "merge",
  usage: "用法: kunpeng merge <flowId> [base] [--allow-sensitive]",
  run: async (context: CliContext) => {
    const actor = resolveCliActor(context.rest, process.env);
    const r = await runMergeCommand(actor.args, context.repoRoot, { clearedBy: { by: actor.by, via: "cli-merge" } });
    if (!r.ok) { console.error(`[merge] ✗ ${r.error}`); process.exit(1); }
    console.log(`[merge] ✓ ${r.note}`);
    const b = await postMergeBuild(context.repoRoot);
    if (b.ran && b.ok) {
      console.log(`[merge] dist 已重建并冒烟通过（${b.version ?? "?"}）`);
    } else if (b.ran && !b.ok) {
      console.error(`[merge] ⚠ 合并已完成，但 dist 重建/冒烟失败：${b.error ?? ""}（请手工 cd orchestrator && npm run build）`);
    }
    return;
  },
});

registerCliCommand({
  name: "scope-check",
  run: async (context: CliContext) => {
    const [specPath, flowId] = context.rest;
    if (!specPath || !flowId) {
      console.error("用法: kunpeng scope-check <spec.md> <flowId> [--repo <仓库>]");
      process.exit(1);
    }

    let specText: string;
    try {
      specText = await readFile(resolve(specPath), "utf8");
    } catch (error) {
      console.error(`范围门无法读取 spec 文件 ${specPath}：${(error as Error).message}`);
      process.exit(1);
    }

    const result = await runScopeCheck(specText, context.repoRoot, flowId);
    for (const message of result.messages) {
      if (result.status === "observed") console.warn(message);
      else if (result.exitCode === 0) console.log(message);
      else console.error(message);
    }
    process.exit(result.exitCode);
  },
});
