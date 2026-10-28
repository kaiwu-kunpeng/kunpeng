import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { readActions } from "../loop/action-ledger.js";
import { createOpsGate, maxLeverLevel } from "../loop/ops-gate.js";
import { pilotNext } from "../loop/ops-pilot.js";
import { isLockBusy, readOpsLock } from "../loop/ops-lock.js";
import { appendOpsSchedule, readOpsSchedule, runPlaybook } from "../loop/ops-playbook-run.js";
import { planOpsTick } from "../loop/ops-schedule-guard.js";
import { fileSwitchboardSender } from "../switchboard/default-sender.js";
import { duePlaybooks } from "../loop/ops-run.js";
import { listPlaybooks } from "../loop/playbook.js";
import {
  instantiateTemplate,
  listTemplates,
  resolveApplyTargetRepo,
  saveTemplateFromProject,
  selectAutoRunLoops,
  solutionsRoot,
} from "../loop/solution-template.js";
import type { LoopDef, Wave } from "../loop/types.js";
import { buildWaveReport, readWaveplans } from "../loop/wave-report.js";
import { kunpengStateDir, readRegistry, readProjectSelf } from "../project/registry.js";
import { resolveProjectStateDir } from "../project/state-resolve.js";
import { daemonPlatform, installDaemonSchedule, uninstallDaemonSchedule, realDaemonIo, renderScheduleHint } from "../runtime/daemon-schedule.js";
import { launchKunpeng, loopRunArgs, opsRunPlaybookArgs } from "../server/launch.js";
import { registerCliCommand, type CliContext } from "./registry.js";
import { runDutyForRepo } from "./duty.js";
import { cliJsPath, findRepoRoot, loopStore, valueAfter } from "./shared.js";

registerCliCommand({
  name: "ops-pilot",
  run: async (context: CliContext) => {
    const loopId = context.rest.find((arg) => !arg.startsWith("--"));
    if (!loopId) {
      console.error("用法: kunpeng ops-pilot <loopId> [--dry]");
      process.exit(1);
    }
    const dry = context.rest.includes("--dry");
    const result = await pilotNext(loopId, {
      apply: !dry,
      store: loopStore(context.repoRoot),
      stateDir: resolveProjectStateDir(context.repoRoot),
    });
    console.log(`[ops-pilot] lever: ${result.plan.lever}`);
    console.log(`[ops-pilot] 技能: ${result.plan.skills.join(", ") || "(无)"}`);
    console.log(`[ops-pilot] 波目标: ${result.plan.waveGoal}`);
    console.log(`[ops-pilot] 止损: ${result.plan.stopLoss}`);
    console.log(`[ops-pilot] 理由: ${result.plan.reason}`);
    console.log(result.applied ? "已写回 nextLever" : "dry-run 未写回");
    return;
  },
});

registerCliCommand({
  name: "ops-report",
  run: async (context: CliContext) => {
    const loopId = context.rest.find((arg) => !arg.startsWith("--"));
    if (!loopId) {
      console.error("用法: kunpeng ops-report <loopId>");
      process.exit(1);
    }
    const stateDir = resolveProjectStateDir(context.repoRoot);
    const actions = await readActions(stateDir, { loopId });
    const action = actions.at(-1);
    if (!action) {
      console.log("该 loop 还没有波记录");
      return;
    }
    const loop = await loopStore(context.repoRoot).read(loopId);
    if (!loop) throw new Error(`loop not found: ${loopId}`);
    const waveplan = (await readWaveplans(stateDir))
      .filter((candidate) => candidate.loopId === loopId && candidate.at <= action.at)
      .at(-1);
    console.log(buildWaveReport({ loop, action, planSkills: waveplan?.plan.skills ?? [] }));
    return;
  },
});

/** `kunpeng loops` 的行渲染（纯函数）：首列 projectId，让多租户串仓一眼可见。 */
export function renderLoopsLines(loops: Array<Pick<LoopDef, "id" | "projectId" | "metric" | "waves" | "nextLever">>): string[] {
  if (loops.length === 0) return ["(无 loop)"];
  return [
    "项目 ｜ loop ｜ 指标 ｜ 波次 ｜ 下一杠杆",
    ...loops.map((loop) => `${loop.projectId} ｜ ${loop.id} ｜ ${loop.metric.current} ｜ ${loop.waves.length} ｜ ${loop.nextLever?.lever ?? "-"}`),
  ];
}

registerCliCommand({
  name: "loops",
  run: async (context: CliContext) => {
    const loops = await loopStore(context.repoRoot).list();
    for (const line of renderLoopsLines(loops)) console.log(line);
    return;
  },
});

registerCliCommand({
  name: "solution",
  run: async (context: CliContext) => {
    const sub = context.rest[0];
    const root = solutionsRoot(process.env);
    const solutionRepoRoot = findRepoRoot(context.repoArg ?? process.env.KUNPENG_REPO ?? process.cwd());

    if (sub === "list") {
      const templates = listTemplates(root);
      if (templates.length === 0) {
        console.log("无方案模板");
        return;
      }
      for (const template of templates) {
        console.log(`${template.id} ｜ ${template.name} ｜ ${template.playbookFiles.length} 张卡`);
      }
      return;
    }

    if (sub === "save") {
      const id = context.rest[1];
      const playbooks = valueAfter(context.rest, "--playbooks")?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
      const configs = valueAfter(context.rest, "--configs")?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
      if (!id || !context.nameArg || playbooks.length === 0) {
        console.error("用法: kunpeng solution save <id> --name <名称> --playbooks <逗号分隔playbookId> [--configs <逗号分隔仓相对路径>]");
        process.exit(1);
      }
      const template = saveTemplateFromProject(root, solutionRepoRoot, { id, name: context.nameArg, playbookIds: playbooks, configPaths: configs });
      console.log(`[solution] 已保存 ${template.id} ｜ ${template.name} ｜ ${template.playbookFiles.length} 张卡 ｜ ${template.configFiles?.length ?? 0} 个配置`);
      return;
    }

    if (sub === "apply") {
      const id = context.rest[1];
      const projectId = valueAfter(context.rest, "--project");
      const runFirstWave = context.rest.includes("--run");
      if (!id || !projectId) {
        console.error("用法: kunpeng solution apply <id> --project <projectId> [--name <名称>] [--run]");
        process.exit(1);
      }
      const registry = await readRegistry(kunpengStateDir()).catch(() => []);
      const explicitRepo = context.repoArg ? solutionRepoRoot : undefined;
      const targetRepo = resolveApplyTargetRepo(projectId, registry, explicitRepo);
      const result = instantiateTemplate(root, id, targetRepo, projectId, { projectName: valueAfter(context.rest, "--name") });
      console.log(`[solution] 目标仓 ${targetRepo}`);
      console.log(`written: ${result.written.length ? result.written.join(", ") : "(无)"}`);
      console.log(`skipped: ${result.skipped.length ? result.skipped.join(", ") : "(无)"}`);
      console.log(`loops written: ${result.loopsWritten.length ? result.loopsWritten.join(", ") : "(无)"}`);
      console.log(`loops skipped: ${result.loopsSkipped.length ? result.loopsSkipped.join(", ") : "(无)"}`);
      console.log(`configs written: ${result.configsWritten.length ? result.configsWritten.join(", ") : "(无)"}`);
      console.log(`configs skipped: ${result.configsSkipped.length ? result.configsSkipped.join(", ") : "(无)"}`);
      if (runFirstWave) {
        const loopIds = selectAutoRunLoops(targetRepo, result.loopsWritten);
        if (loopIds.length === 0) {
          console.log("[solution] 无 autonomous loop 可自动拉起");
        } else {
          for (const loopId of loopIds) {
            const launched = launchKunpeng(
              {
                execPath: process.execPath,
                cliJs: cliJsPath(),
              },
              loopRunArgs(loopId, targetRepo),
              targetRepo,
            );
            console.log(`[solution] 自动首波 ${loopId} pid ${launched.pid}`);
          }
        }
      }
      return;
    }

    console.error("用法: kunpeng solution <list|save|apply>");
    process.exit(1);
  },
});

registerCliCommand({
  name: "ops",
  run: async (context: CliContext) => {
    if (context.rest[0] === "resume") {
      // 人工解除自动暂停：账本追加一条 resumed，连续失败计数从这里重新起算。
      const playbookId = context.rest[1];
      if (!playbookId?.trim() || playbookId.startsWith("--")) {
        console.error("用法: kunpeng ops resume <playbookId> [--repo <repo>]");
        process.exitCode = 1;
        return;
      }
      await appendOpsSchedule(resolveProjectStateDir(context.repoRoot), { at: Date.now(), playbookId, outcome: "resumed", detail: "人工恢复" });
      console.log(`[ops] ${playbookId} 已恢复，下一轮到期照常起跑`);
      return;
    }
    if (context.rest[0] === "run-playbook") {
      const playbookId = context.rest[1];
      if (!playbookId?.trim() || playbookId.startsWith("--")) {
        console.error("用法: kunpeng ops run-playbook <playbookId> [--repo <repo>]");
        process.exitCode = 1;
        return;
      }
      const entry = await runPlaybook(context.repoRoot, resolveProjectStateDir(context.repoRoot), playbookId);
      console.log(`[ops] ${playbookId} ${entry.outcome}${entry.detail ? `: ${entry.detail}` : ""}`);
      if (entry.outcome === "error") process.exitCode = 1;
      return;
    }
    // Ops 定时器：把到期 playbook 分流为 auto run-playbook 或 review 人工门。
    // --install/--uninstall/--print-cron 管 OS 级调度（--install 是唯一系统副作用，显式触发）。
    const cliPath = cliJsPath();
    const workingDir = resolve(dirname(cliPath), "..");  // orchestrator/（node_modules 所在）
    const cliJs = join(workingDir, "dist", "cli.js");
    const repoParts = context.repoRoot.split(/[\\/]/).filter(Boolean);
    const projectId = (await readProjectSelf(context.repoRoot))?.id ?? repoParts[repoParts.length - 1] ?? "default";
    const label = `com.kunpeng.ops.${projectId}`;
    if (context.flags.has("--print-cron")) {
      const minutes = context.intervalArg ? Math.max(1, Math.round(Number(context.intervalArg) / 60)) : 1440;
      console.log(renderScheduleHint({
        platform: daemonPlatform(),
        intervalMinutes: minutes,
        command: `${process.execPath} ${cliJs} ops --repo ${context.repoRoot}`,
        label: "kunpeng-ops",
      }));
      return;
    }
    if (context.flags.has("--uninstall")) {
      try {
        const r = await uninstallDaemonSchedule(label, daemonPlatform(), realDaemonIo());
        console.log(`[ops] 已卸载定时调度：${r.removed.join(", ")}`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
        return;
      }
      return;
    }
    if (context.flags.has("--install")) {
      const rawInterval = context.intervalArg ? Number(context.intervalArg) : 86400;
      const intervalSeconds = Number.isFinite(rawInterval) ? Math.max(60, rawInterval) : 86400;
      const installArgs = [cliJs, "ops", "--repo", context.repoRoot];
      // launchd 极简环境必须显式注入认证所需 env，否则后台 loop run 可能找不到后端登录态。
      const env: Record<string, string> = {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        HOME: process.env.HOME ?? homedir(),
        USER: process.env.USER ?? process.env.LOGNAME ?? "",
        LOGNAME: process.env.LOGNAME ?? process.env.USER ?? "",
        KUNPENG_BACKEND: process.env.KUNPENG_BACKEND ?? "codex",
      };
      const spec = { label, binPath: process.execPath, args: installArgs, intervalSeconds, workingDir, env };
      try {
        const r = await installDaemonSchedule(spec, daemonPlatform(), realDaemonIo());
        console.log(`[ops] 已安装定时调度（唯一系统副作用，显式 --install）：`);
        console.log(`  调度文件: ${r.paths.join(", ")}`);
        console.log(`  间隔:   每 ${intervalSeconds}s 跑一次 ops --repo ${context.repoRoot}`);
        console.log(`  后端:   KUNPENG_BACKEND=${env.KUNPENG_BACKEND}（已注入 PATH/HOME/USER/LOGNAME）`);
        console.log(`  卸载:   kunpeng ops --repo ${context.repoRoot} --uninstall`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
        return;
      }
      return;
    }

    const playbooks = await listPlaybooks(context.repoRoot);
    const loops = await loopStore(context.repoRoot).list();
    const lastRunByLoop: Record<string, number> = {};
    for (const loop of loops) {
      const lastWave = loop.waves.reduce<Wave | undefined>(
        (latest, wave) => latest === undefined || wave.seq > latest.seq ? wave : latest,
        undefined,
      );
      if (lastWave !== undefined) lastRunByLoop[loop.id] = lastWave.at;
    }

    const now = Date.now();
    const due = new Set(duePlaybooks(playbooks, lastRunByLoop, now).map((playbook) => playbook.id));
    const stateDir = resolveProjectStateDir(context.repoRoot);
    const entries = await readOpsSchedule(stateDir);
    const isAlive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
    const lockBusy = new Map<string, boolean>();
    for (const playbook of playbooks) {
      if (playbook.loopId && !lockBusy.has(playbook.loopId)) lockBusy.set(playbook.loopId, isLockBusy(await readOpsLock(stateDir, playbook.loopId), isAlive));
    }
    const decisions = planOpsTick({ playbooks, due, lastRunByLoop, entries, lockBusy: (loopId) => lockBusy.get(loopId) ?? false, now });
    const alerts = fileSwitchboardSender();
    const alert = async (body: string, topic: string): Promise<void> => {
      try {
        await alerts.send({ from: "ops", to: "all", topic, body, urgent: true, origin: { kind: "schedule" } });
      } catch {
        // 告警尽力而为；发不出去不影响调度本身。
      }
    };
    const launchDeps = { execPath: process.execPath, cliJs };
    let launched = 0;
    for (const playbook of playbooks) {
      const loopId = playbook.loopId;
      const mine = decisions.filter((d) => d.playbookId === playbook.id);
      for (const d of mine.filter((x) => x.action === "missed" || x.action === "missed-quiet")) {
        await appendOpsSchedule(stateDir, { at: now, playbookId: playbook.id, loopId, outcome: "missed", detail: d.detail });
        if (d.action === "missed") await alert(`运营 playbook ${playbook.id} 漏跑：${d.detail}`, playbook.id);
        console.log(`[ops] ${playbook.id} 漏跑：${d.detail}`);
      }
      const main = mine.find((x) => x.action !== "missed" && x.action !== "missed-quiet");
      if (!main || main.action === "not-due" || main.action === "no-loop") continue;
      if (playbook.gate === "auto" && loopId) {
        if (main.action === "paused" || main.action === "paused-quiet") {
          await appendOpsSchedule(stateDir, { at: now, playbookId: playbook.id, loopId, outcome: "paused", detail: main.detail });
          if (main.action === "paused") await alert(`运营 playbook ${playbook.id} 已自动暂停：${main.detail}`, playbook.id);
          console.log(`[ops] ${playbook.id} 自动暂停：${main.detail}`);
          continue;
        }
        if (main.action === "locked") {
          await appendOpsSchedule(stateDir, { at: now, playbookId: playbook.id, loopId, outcome: "locked", detail: "同 loop 另一波仍在跑，本轮跳过" });
          console.log(`[ops] ${playbook.id} loop ${loopId} 正在运行，跳过`);
          continue;
        }
        const run = launchKunpeng(launchDeps, opsRunPlaybookArgs(playbook.id, context.repoRoot), context.repoRoot);
        console.log(`[ops] ${playbook.id} auto → run-playbook pid=${run.pid} log=${run.logPath}`);
        launched++;
        continue;
      }
      if (!loopId) {
        console.log(`[ops] ${playbook.id} 缺少 loopId，跳过`);
        continue;
      }
      const level = maxLeverLevel(loops.find((loop) => loop.id === loopId)?.levers);
      const gate = await createOpsGate(context.repoRoot, {
        projectId,
        playbookId: playbook.id,
        loopId,
        reason: `playbook 到期：${playbook.title || playbook.id}`,
        ...(level ? { level } : {}),
      });
      await appendOpsSchedule(stateDir, { at: now, playbookId: playbook.id, loopId, outcome: "gated", detail: gate.id });
      console.log(`[ops] ${playbook.id} review → gate ${gate.id}`);
    }
    if (due.size === 0 && launched === 0) console.log("[ops] 无到期 playbook");
    // 值班员随定时器跑一轮（P1-12c）：幽灵流 / 守门红 / 漏跑 / 推送失败 / 后端全挂 按手册处置，失败不影响调度；--no-duty 关。
    if (!context.rest.includes("--no-duty")) {
      try {
        await runDutyForRepo({ repoRoot: context.repoRoot, dryRun: false, log: (line) => console.log(line) });
      } catch (error) {
        console.warn(`[ops] 值班员本轮失败（不影响调度）：${String(error).slice(0, 160)}`);
      }
    }
    return;
  },
});
