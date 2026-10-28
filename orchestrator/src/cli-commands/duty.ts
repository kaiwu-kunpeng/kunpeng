import { FlowTracker } from "../runtime/flowstate.js";
import { isLockBusy, readOpsLock } from "../loop/ops-lock.js";
import { readOpsSchedule } from "../loop/ops-playbook-run.js";
import { duePlaybooks } from "../loop/ops-run.js";
import { planOpsTick } from "../loop/ops-schedule-guard.js";
import { listOutbox } from "../loop/outbox.js";
import { listPlaybooks } from "../loop/playbook.js";
import { defaultDutyExecutors, runDutyTick, type DutyTickItem } from "../loop/runbooks/duty-officer.js";
import { eventsFromFlows, eventsFromOpsTick, eventsFromOutbox } from "../loop/runbooks/events.js";
import type { Wave } from "../loop/types.js";
import { readProjectSelf } from "../project/registry.js";
import { resolveProjectStateDir } from "../project/state-resolve.js";
import { launchKunpeng } from "../server/launch.js";
import { fileSwitchboardSender } from "../switchboard/default-sender.js";
import { registerCliCommand, type CliContext } from "./registry.js";
import { cliJsPath, findRepoRoot, loopStore, valueAfter } from "./shared.js";

const USAGE = "用法: kunpeng duty tick [--repo <path>] [--dry]  —— 值班员跑一轮：从运营账本 / 流状态 / outbox 派生事件，按处置手册执行 L0–L2 动作，其余转人";

/** 值班员一轮（供 `duty tick` 与 `ops` 定时器共用）：三路事件 → 手册 → 执行 / 转人，返回明细。 */
export async function runDutyForRepo(input: { repoRoot: string; dryRun: boolean; log: (line: string) => void; now?: number }): Promise<DutyTickItem[]> {
    const { repoRoot, dryRun, log } = input;
    const stateDir = resolveProjectStateDir(repoRoot);
    const projectId = (await readProjectSelf(repoRoot))?.id ?? "unknown";
    const now = input.now ?? Date.now();
    const isAlive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ESRCH") return false;
        if (code === "EPERM") return true;
        throw error;
      }
    };

    const playbooks = await listPlaybooks(repoRoot);
    const lastRunByLoop: Record<string, number> = {};
    for (const loop of await loopStore(repoRoot).list()) {
      const lastWave = loop.waves.reduce<Wave | undefined>((latest, wave) => latest === undefined || wave.seq > latest.seq ? wave : latest, undefined);
      if (lastWave !== undefined) lastRunByLoop[loop.id] = lastWave.at;
    }
    const entries = await readOpsSchedule(stateDir);
    const lockBusy = new Map<string, boolean>();
    for (const playbook of playbooks) {
      if (playbook.loopId && !lockBusy.has(playbook.loopId)) lockBusy.set(playbook.loopId, isLockBusy(await readOpsLock(stateDir, playbook.loopId), isAlive));
    }
    const due = new Set(duePlaybooks(playbooks, lastRunByLoop, now).map((playbook) => playbook.id));
    const decisions = planOpsTick({ playbooks, due, lastRunByLoop, entries, lockBusy: (loopId) => lockBusy.get(loopId) ?? false, now });
    const tracker = new FlowTracker(stateDir);
    const events = [
      ...eventsFromOpsTick(decisions, projectId, now),
      ...eventsFromFlows(await tracker.list(), { projectId, isAlive, now }),
      ...eventsFromOutbox(listOutbox(repoRoot), { projectId, now }),
    ];
    const sender = fileSwitchboardSender();
    const items = await runDutyTick({
      stateDir, events, now, dryRun,
      executors: defaultDutyExecutors({ repoRoot, stateDir, sender, tracker, launch: (args) => launchKunpeng({ execPath: process.execPath, cliJs: cliJsPath() }, args, repoRoot) }),
      escalate: async (event, reason) => {
        if (dryRun) return;
        try {
          await sender.send({ from: "duty", to: "all", topic: `值班员转人 · ${event.kind}`, body: `${reason}\n范围 ${JSON.stringify(event.scope)}`, urgent: true, origin: { kind: "schedule" } });
        } catch {
          // 转人通知尽力而为；发不出去不影响本轮其余处置。
        }
      },
      log,
    });
    log(`[duty] 事件 ${events.length} 条 → 处置 ${items.filter((item) => item.outcome === "executed").length}、转人 ${items.filter((item) => item.outcome === "escalated").length}、冷却 ${items.filter((item) => item.outcome === "cooldown").length}${dryRun ? `、干跑 ${items.filter((item) => item.outcome === "dry-run").length}` : ""}`);
    for (const item of items) log(`  - ${item.outcome} ${item.event.kind} ${JSON.stringify(item.event.scope)}${item.detail ? ` · ${item.detail.split("\n")[0]}` : ""}`);
    return items;
}

registerCliCommand({
  name: "duty",
  usage: USAGE,
  run: async (context: CliContext) => {
    if (context.rest[0] !== "tick") {
      console.error(USAGE);
      process.exitCode = 1;
      return;
    }
    await runDutyForRepo({ repoRoot: findRepoRoot(valueAfter(context.rest, "--repo") ?? context.repoRoot), dryRun: context.rest.includes("--dry"), log: (line) => console.log(line) });
  },
});
