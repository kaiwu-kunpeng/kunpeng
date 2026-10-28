import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolveProjectStateDir } from "../project/state-resolve.js";
import { join } from "node:path";
import { ArtifactStore } from "../artifacts/store.js";
import { CliRunner } from "../agent/cli-runner.js";
import { compileAll, type CompileAllItem } from "../compile/compile-all.js";
import type { ReinjectTask } from "../feedback/finding-to-task.js";
import { ReinjectStore } from "../feedback/reinject-store.js";
import { Workspace } from "../git/workspace.js";
import { parseMethodPlan } from "../plan/parse.js";
import { readRegistry, kunpengStateDir } from "../project/registry.js";
import { detectChecks } from "../project/detect.js";
import { FlowTracker } from "../runtime/flowstate.js";
import { reconcileDeadFlows } from "../runtime/reconcile.js";
import { runPlan } from "../plan/orchestrator.js";
import { applyConventions } from "./apply-conventions.js";
import { applyApprovedProposals, evolutionProposalFromArtifact } from "./apply.js";
import { expireStaleApproved } from "./approved-expiry.js";
import { auditGeneratedPlan } from "./audit-plan.js";
import { backlogConventionsApplier, conventionsLanded } from "./conventions-backlog.js";
import { draftPlanFromUpgrades } from "./draft-plan.js";
import { route } from "./route.js";
import { backlogSkillsApplier } from "./skills-backlog.js";
import { validateSkillMd } from "../skills/skill-md.js";

export function preReviewNoteOf(p: { id: string; meta?: Record<string, unknown> }): string | undefined {
  const preReview = p.meta?.preReview as { verdict?: unknown; reason?: unknown } | undefined;
  const verdict = preReview?.verdict;
  if (typeof verdict !== "string" || !verdict.trim()) return undefined;
  const reason = preReview?.reason;
  return `预审 ${verdict}${typeof reason === "string" && reason.trim() ? `：${reason}` : ""}`;
}

export interface ApplyLiveOptions {
  live?: boolean;
  propagate?: (kunpengHome: string) => Promise<CompileAllItem[]>;
}

export async function runApplyApprovedLive(repoRoot: string, kunpengHome: string, opts: ApplyLiveOptions = {}): Promise<void> {
  // 升级自举（P2d）：把人工门 #2 批准(approved)的提案真正落地。
  // 约定类 → 默认入 backlog，显式 live 才直写；升级类 → 翻成方案 → 审计门(fail-closed) → 安全才自动跑 plan(停门#1)。
  const live = opts.live === true;
  const artifactsDir = join(repoRoot, ".kunpeng", "artifacts");
  const store = new ArtifactStore(artifactsDir);
  await expireStaleApproved(store, {
    nowMs: Date.now(),
    mtimeOf: async (id) => (await stat(join(artifactsDir, `${id}.md`))).mtimeMs,
  });
  const allProposals = await store.list("proposal");
  const conventionsPath = join(kunpengHome, "constitution", "conventions.md");
  const awaiting = allProposals.filter((p) => p.status === "in-progress" && (p.meta.landing as { channel?: unknown })?.channel === "backlog");
  if (awaiting.length) {
    const text = await readFile(conventionsPath, "utf8").catch(() => "");
    for (const p of awaiting) {
      if (!conventionsLanded(text, evolutionProposalFromArtifact(p).changes)) continue;
      try {
        await store.transition(p.id, "verified");
        console.log(`[应用] ${p.id}：约定已落地，转 verified`);
      } catch (error) {
        console.warn(`[应用] ${p.id}：落地确认回写失败：${String(error)}`);
      }
    }
  }
  const approved = allProposals.filter((p) => p.status === "approved");
  for (const p of approved) {
    const note = preReviewNoteOf(p);
    if (note) {
      console.log(`[应用] AI 预审附注（只作分诊、不当门，ADR 0012）${p.id}：${note}；放行仍看可执行证据闸`);
      await store.patchMeta(p.id, { preReviewNote: note });
    }
  }
  if (!approved.length) { console.log("[应用] 无已批准(approved)提案。先在总控台门#2批准草案。"); return; }
  const proposals = approved.map(evolutionProposalFromArtifact);
  const feedbackStore = new ReinjectStore(join(repoRoot, ".kunpeng", "feedback"));
  const enqueuedTasks: ReinjectTask[] = [];
  const conventionsApplier = live ? applyConventions : backlogConventionsApplier({
    readConventions: (mdPath) => readFile(mdPath, "utf8"),
    enqueue: (task) => feedbackStore.enqueue([task], Date.now()),
    onEnqueued: (task) => { enqueuedTasks.push(task); },
  });
  const runner = new CliRunner();
  // planRunner：把审计放行的方案写临时文件并自动跑 plan（停在门#1，绝不自动合主干）。
  const planRunner = async (planMd: string): Promise<void> => {
    const evoDir = join(repoRoot, ".kunpeng", "evolution");
    await mkdir(evoDir, { recursive: true });
    const planFile = join(evoDir, `plan-${Date.now().toString(36)}.md`);
    await writeFile(planFile, planMd, "utf8");
    const model = parseMethodPlan(planMd);
    const ws = new Workspace(repoRoot);
    await ws.reclaimDeadLocks().catch(() => {}); // B3：自动跑 plan 前也清死锁，避免陈旧锁挡住升级自举
    const tracker = new FlowTracker(resolveProjectStateDir(repoRoot));
    await reconcileDeadFlows(tracker).catch(() => {}); // 同收口：把崩溃残留的幽灵 running 流调成 crashed
    const detected = await detectChecks(repoRoot);
    const checks = detected.typecheck ? [detected.typecheck] : [];
    console.log(`  [应用] 升级方案过审计 → 自动 kunpeng plan（停门#1）：${planFile}`);
    await runPlan(model, { repoRoot, store, ws, tracker, runner, checks, projectRules: "", concurrency: 3 });
  };
  const report = await applyApprovedProposals(proposals, {
    conventionsPath, route, applyConventions: conventionsApplier, draftPlanFromUpgrades, auditGeneratedPlan,
    draftRunner: runner, planRunner,
    applySkills: backlogSkillsApplier({
      readDraft: (slug) => readFile(join(repoRoot, ".kunpeng", "skills", slug, "SKILL.md"), "utf8").catch(() => null),
      readRepoSkill: (slug) => readFile(join(kunpengHome, "skills", slug, "SKILL.md"), "utf8").catch(() => null),
      validate: validateSkillMd,
      enqueue: (task) => feedbackStore.enqueue([task], Date.now()),
      onEnqueued: (task) => { enqueuedTasks.push(task); },
    }),
  });
  // 回写：backlog 交接→in-progress 待确认；成功落地→verified；被审计拦下→review 留痕、留 approved 待人工。
  for (const o of report.outcomes) {
    if (o.status === "verified" && ((!live && o.conventionsApplied > 0) || o.skillsEnqueued > 0)) {
      const taskCount = (!live && o.conventionsApplied > 0 ? 1 : 0) + o.skillsEnqueued;
      const task = enqueuedTasks.shift();
      for (let i = 1; i < taskCount; i++) enqueuedTasks.shift();
      try {
        await store.patchMeta(o.id, { landing: { channel: "backlog", fingerprint: task?.fingerprint, enqueuedAt: new Date().toISOString() } });
        await store.transition(o.id, "in-progress");
        console.log(`[应用] ${o.id}：已交接 backlog，转 in-progress 等待约定落地`);
      } catch (error) {
        console.warn(`[应用] ${o.id}：backlog 交接回写失败：${String(error)}`);
      }
      continue;
    }
    if (o.status === "verified") { try { await store.transition(o.id, "in-progress"); await store.transition(o.id, "verified"); } catch { /* 已是终态 */ } }
    if (o.violations.length) {
      await store.write({
        kind: "review", id: `audit-block-${o.id}`, status: "draft",
        body: `提案 ${o.id} 的升级方案被审计门拦下（fail-closed，未运行）：\n${o.violations.map((v) => `- [${v.id}] ${v.reason}（命中: ${v.match}）`).join("\n")}`,
        meta: { violations: o.violations, proposal: o.id },
      });
    }
  }
  const blocked = report.outcomes.filter((o) => o.violations.length).length;
  const hadUnrouted = report.outcomes.filter((o) => o.unrouted.length).length;
  console.log(`[应用] 处理 ${report.outcomes.length} 提案：约定追加 ${report.conventionsApplied} 条 · 约定拒绝 ${report.conventionsRejected} 条 · 跑升级计划 ${report.plansRun} 次 · 审计拦下 ${blocked} 条 · 技能入队 ${report.skillsEnqueued} 条`);
  for (const o of report.outcomes) {
    if (o.violations.length) console.log(`  ⚠ ${o.id}：升级方案被审计拦下(${o.violations.length}违规)，未跑、留 approved 待人工`);
    if (o.unrouted.length) console.log(`  ⚠ ${o.id}：${o.unrouted.length} 条变更落禁区/未知(含 core)，已跳过不落地`);
  }
  console.log(live
    ? `  约定改动写入 ${conventionsPath}（门#2 已批；core 永不可被自进化改）。升级若跑了 plan，去总控台门#1 合并集成分支。`
    : "  约定改动不直写宿主：已排进 backlog（.kunpeng/feedback），由 flywheel 派流修改 constitution/conventions.md，合并停人工门#1。升级若跑了 plan，去总控台门#1 合并集成分支。技能改动同样只入 backlog，由派流写 skills/<slug>/SKILL.md，合并停人工门#1。");
  if (hadUnrouted || blocked) console.log(`  安全线生效：审计 fail-closed + 禁区兜底 + 落主干仍人工门#1。`);
  // 跨项目传播：新约定一落 conventions.md 就编译到所有已注册项目，让每个项目当天拿到（闭合「per-repo compile 不自动传播」断点）。
  if (live && report.conventionsApplied > 0) {
    const propagate = opts.propagate ?? (async (home: string) => compileAll(home, await readRegistry(kunpengStateDir())));
    const items = await propagate(kunpengHome);
    const ok = items.filter((i) => !i.error).length;
    console.log(`  [跨项目传播] 已把更新后的宪法编译到 ${ok}/${items.length} 个项目的 AGENTS.md`);
    for (const it of items.filter((i) => i.error)) console.log(`    ✗ ${it.id}：${it.error}`);
  }
}
