import { join, dirname, resolve } from "node:path";
import { CliRunner } from "../agent/cli-runner.js";
import { ArtifactStore } from "../artifacts/store.js";
import { runApplyApprovedLive } from "../evolution/apply-live.js";
import { landApprovedChannelProposals } from "../evolution/landing.js";
import { liveModuleStatuses } from "../evolution/live-module-status.js";
import { runMaintenanceLive } from "../evolution/maintenance-run.js";
import { applyMerges, planConsolidation } from "../knowledge/lesson-consolidate.js";
import { distillFailureLessons } from "../knowledge/lesson-distill.js";
import { listLessons, type LessonEntry } from "../knowledge/lesson-store.js";
import { buildGuardianReport } from "../loop/guardian-report.js";
import { logMaintenance } from "../metrics/maintenance-ledger.js";
import { kunpengStateDir, readRegistry, readProjectSelf } from "../project/registry.js";
import { resolveProjectStateDir } from "../project/state-resolve.js";
import { AgentResearcher } from "../research/researcher.js";
import {
  daemonPlatform,
  installDaemonSchedule,
  realDaemonIo,
  uninstallDaemonSchedule,
} from "../runtime/daemon-schedule.js";
import { FlowTracker } from "../runtime/flowstate.js";
import { trimLogDir } from "../runtime/log-trim.js";
import { archiveStalePresence } from "../switchboard/presence-archive.js";
import {
  reconcileDeadFlows,
  reconcileGhostMergeGates,
  reconcileOrphanWorktrees,
  reconcileStaleArtifacts,
} from "../runtime/reconcile.js";
import { createTask } from "../task/store.js";
import { writeFileAtomic } from "../util/atomic-write.js";
import { registerCliCommand, type CliContext } from "./registry.js";
import { cliJsPath } from "./shared.js";

export function planMaintainLessons(lessons: LessonEntry[]): {
  merges: ReturnType<typeof planConsolidation>["merges"];
  graduateCount: number;
  retireCount: number;
} {
  const plan = planConsolidation(lessons);
  const proposalIds = new Set([
    ...plan.graduateProposals.map((proposal) => proposal.id),
    ...plan.retireProposals.map((proposal) => proposal.id),
  ]);
  const mergePlan = planConsolidation(lessons.filter((lesson) => !proposalIds.has(lesson.id)));
  return {
    merges: mergePlan.merges,
    graduateCount: plan.graduateProposals.length,
    retireCount: plan.retireProposals.length,
  };
}

registerCliCommand({
  name: "guardian-report",
  run: async (context: CliContext) => {
    const tracker = new FlowTracker(resolveProjectStateDir(context.repoRoot));

    const ghostGates = await reconcileGhostMergeGates(context.repoRoot).then((r) => r.cleared).catch((): string[] => []);
    const orphanWorktrees = await reconcileOrphanWorktrees(context.repoRoot).then((r) => r.pruned).catch((): string[] => []);
    const staleArtifacts = await reconcileStaleArtifacts(tracker).then((r) => r.cleared).catch((): string[] => []);
    const deadFlows = await reconcileDeadFlows(tracker).then((r) => r.reconciled).catch((): string[] => []);

    const report = buildGuardianReport({ deadFlows, staleArtifacts, ghostGates, orphanWorktrees });
    console.log(report.summary);
    for (const section of report.sections) {
      console.log(`${section.name}: ${section.count}`);
      for (const item of section.items) {
        console.log(`  ${item}`);
      }
    }
    return;
  },
});

registerCliCommand({
  name: "maintain",
  run: async (context: CliContext) => {
    const cliPath = cliJsPath();
    const workingDir = resolve(dirname(cliPath), "..");  // orchestrator/（node_modules 所在）
    const cliJs = join(workingDir, "dist", "cli.js");
    if (context.rest[0] === "log") {
      const what = context.rest[1] ?? "";
      const minutes = Number(context.rest[2]);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        console.error("用法: kunpeng maintain log \"<what>\" <minutes>（minutes 必须为正数）");
        process.exit(1);
      }
      const entry = logMaintenance(resolveProjectStateDir(context.repoRoot), what, minutes);
      console.log(`已记维护 ${entry.id} ｜ ${what} ｜ ${minutes} 分钟`);
      return;
    }
    const projectId =
      (await readProjectSelf(context.repoRoot))?.id ??
      (await readRegistry(kunpengStateDir())).find((p) => p.repoPath === context.repoRoot)?.id ??
      "default";
    const label = `com.kunpeng.maintain.${projectId}`;

    if (context.flags.has("--uninstall")) {
      try {
        const r = await uninstallDaemonSchedule(label, daemonPlatform(), realDaemonIo());
        console.log(`[maintain] 已卸载定时调度：${r.removed.join(", ")}`);
        return;
      } catch (error) {
        console.error(String(error));
        process.exitCode = 1;
        return;
      }
    }
    if (context.flags.has("--install")) {
      const intervalSeconds = context.intervalArg ? Math.max(60, Number(context.intervalArg)) : 86400;
      const installArgs = [cliJs, "maintain", "--repo", context.repoRoot];
      if (context.flags.has("--research")) installArgs.push("--research");
      const spec = { label, binPath: process.execPath, args: installArgs, intervalSeconds, workingDir };
      try {
        const r = await installDaemonSchedule(spec, daemonPlatform(), realDaemonIo());
        console.log(`[maintain] 已安装定时维护（唯一系统副作用，显式 --install）：`);
        console.log(`  调度文件:  ${r.paths.join(", ")}`);
        console.log(`  间隔:   每 ${intervalSeconds}s 跑一次 maintain --repo ${context.repoRoot}${context.flags.has("--research") ? " --research" : ""}`);
        if (context.flags.has("--research")) console.log("  research: 已开启联网 ears 通道，会消耗 token。");
        console.log(`  卸载:   kunpeng maintain --repo ${context.repoRoot} --uninstall`);
        return;
      } catch (error) {
        console.error(String(error));
        process.exitCode = 1;
        return;
      }
    }

    const researcher = context.flags.has("--research") ? new AgentResearcher(new CliRunner()) : undefined;
    if (researcher) console.log("[maintain] --research 已开启联网 ears 通道，会消耗 token。");
    const r = await runMaintenanceLive(context.repoRoot, {
      moduleStatuses: () => liveModuleStatuses(context.repoRoot),
      researcher,
    });
    console.log(`[maintain] findingsTotal=${r.findingsTotal} selected=${r.selected} proposalsWritten=${r.proposalsWritten} capturesWritten=${r.capturesWritten}`);
    try {
      const presenceArchive = await archiveStalePresence({
        presenceDir: join(kunpengStateDir(), "presence"),
        archiveRoot: join(kunpengStateDir(), "presence-archive"),
        nowMs: Date.now(),
        dateLabel: new Date().toISOString().slice(0, 10),
      });
      console.log(
        `[maintain] presence archived=${presenceArchive.archived} kept=${presenceArchive.kept} unclassified=${presenceArchive.unclassified} archiveDir=${presenceArchive.archiveDir}`,
      );
    } catch (error) {
      console.error(`[maintain] presence 归档失败，已隔离：${String(error)}`);
    }
    try {
      const trimmedLogs = trimLogDir(join(kunpengStateDir(), "logs"));
      for (const t of trimmedLogs) {
        console.log(t.error
          ? `[maintain] 日志截断失败 ${t.file}：${t.error}`
          : `[maintain] 日志截断 ${t.file}：${t.before} → ${t.after} 字节（原地 O_TRUNC，inode 不变）`);
      }
    } catch (error) {
      console.error(`[maintain] 日志截断失败，已隔离：${String(error)}`);
    }
    console.log("  去 cockpit 自进化页查看 proposal / KB capture。");
    if (context.flags.has("--scan-only")) {
      console.log("[maintain] --scan-only：跳过自动落地/应用");
      return;
    }
    if (process.env.KP_MAINTAIN_LESSONS !== "0") {
      try {
        const stateDir = resolveProjectStateDir(context.repoRoot);
        const distilled = await distillFailureLessons(context.repoRoot, { stateDir, days: 1 });
        const lessons = await listLessons(stateDir);
        const lessonPlan = planMaintainLessons(lessons);
        const merged = applyMerges(lessons, lessonPlan.merges);
        const path = join(stateDir, "skills", "lessons.jsonl");
        await writeFileAtomic(path, `${merged.map((lesson) => JSON.stringify(lesson)).join("\n")}\n`);
        console.log(
          `[失败复利] 蒸馏 ${distilled.written} 条 / 合并 ${lessonPlan.merges.length} 组 / 毕业候选 ${lessonPlan.graduateCount} / 退役候选 ${lessonPlan.retireCount}`,
        );
      } catch (error) {
        console.error(`[失败复利] 执行失败，已隔离：${String(error)}`);
      }
    }
    const store = new ArtifactStore(join(context.repoRoot, ".kunpeng", "artifacts"));
    const approved = (await store.list("proposal")).filter((p) => p.status === "approved");
    const landing = await landApprovedChannelProposals(approved, {
      createTask: (t) => createTask(context.repoRoot, t),
      transition: (id, to) => store.transition(id, to as never),
      projectId,
    });
    console.log(`[maintain] 落地：转任务 ${landing.landed.length} 条 · 跳过 ${landing.skipped.length} 条`);
    await runApplyApprovedLive(context.repoRoot, context.kunpengHome);
    return;
  },
});

registerCliCommand({
  name: "apply",
  run: async (context: CliContext) => {
    await runApplyApprovedLive(context.repoRoot, context.kunpengHome, { live: context.flags.has("--live") });
    return;
  },
});
