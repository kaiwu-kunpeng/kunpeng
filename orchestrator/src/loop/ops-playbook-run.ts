import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SwitchboardSender } from "../switchboard/store.js";
import { readActions } from "./action-ledger.js";
import { runLoopWave } from "./driver.js";
import { acquireOpsLock } from "./ops-lock.js";
import { pilotNext } from "./ops-pilot.js";
import { listPlaybooks } from "./playbook.js";
import { LoopStore } from "./store.js";
import { buildWaveReport, persistSkillOutcomes, readWaveplans, type PersistSkillOutcomesInput, type PersistSkillOutcomesResult } from "./wave-report.js";
import { skillsRoot } from "../skills/registry.js";
import { appendLesson } from "../knowledge/lesson-store.js";
import { distillOpsLessons } from "../knowledge/ops-lesson-distill.js";

export interface OpsScheduleEntry {
  at: number;
  playbookId: string;
  loopId?: string;
  outcome: "ran" | "gated" | "locked" | "skipped" | "error" | "paused" | "missed" | "resumed";
  detail?: string;
}

export interface RunPlaybookDeps {
  now?: () => number;
  isAlive?: (pid: number) => boolean;
  pilot?: (loopId: string) => Promise<unknown>;
  runWave?: typeof runLoopWave;
  switchboard?: SwitchboardSender;
  log?: (message: string) => void;
  /** 波结束后把领航选的技能战绩写回注册表（审计 G4：`persistSkillOutcomes` 此前无调用方，学习环断线）。 */
  persistOutcomes?: (input: PersistSkillOutcomesInput) => Promise<PersistSkillOutcomesResult>;
}

export function opsSchedulePath(stateDir: string): string {
  return join(stateDir, "ops", "schedule.jsonl");
}

/** 读应跑账本（坏行跳过，不抛）。 */
export async function readOpsSchedule(stateDir: string): Promise<OpsScheduleEntry[]> {
  let raw: string;
  try {
    raw = await readFile(opsSchedulePath(stateDir), "utf8");
  } catch {
    return [];
  }
  const out: OpsScheduleEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Partial<OpsScheduleEntry>;
      if (typeof parsed.at === "number" && typeof parsed.playbookId === "string" && typeof parsed.outcome === "string") out.push(parsed as OpsScheduleEntry);
    } catch {
      // 账本是只增文件，坏一行不许拖垮整张账。
    }
  }
  return out;
}

export async function appendOpsSchedule(stateDir: string, entry: OpsScheduleEntry): Promise<void> {
  const path = opsSchedulePath(stateDir);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
}

export async function runPlaybook(
  repoRoot: string,
  stateDir: string,
  playbookId: string,
  deps: RunPlaybookDeps = {},
): Promise<OpsScheduleEntry> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? console.log;
  const entry: OpsScheduleEntry = { at: now(), playbookId, outcome: "error" };
  let release: (() => Promise<void>) | null = null;
  try {
    try {
      const playbook = (await listPlaybooks(repoRoot)).find((candidate) => candidate.id === playbookId);
      if (!playbook) throw new Error(`playbook not found: ${playbookId}`);
      const loopId = playbook.loopId;
      if (!loopId) {
        entry.outcome = "skipped";
        entry.detail = "缺少 loopId";
      } else {
        entry.loopId = loopId;
        release = await acquireOpsLock(stateDir, loopId, { playbookId, now, isAlive: deps.isAlive });
        if (!release) {
          entry.outcome = "locked";
        } else {
          const store = new LoopStore(join(repoRoot, ".kunpeng", "loops"));
          if (playbook.pilot === true) {
            const pilot = deps.pilot ?? ((id: string) => pilotNext(id, { apply: true, store, stateDir }));
            await pilot(loopId);
          }
          const result = await (deps.runWave ?? runLoopWave)(loopId, {
            repoRoot, store, now, switchboard: deps.switchboard,
          });
          if (result.gated) {
            entry.outcome = "gated";
            entry.detail = result.humanGate.what;
          } else {
            const loopActions = await readActions(stateDir, { loopId });
            const action = loopActions.at(-1);
            if (action) {
              const loopWaveplans = (await readWaveplans(stateDir)).filter((candidate) => candidate.loopId === loopId);
              const waveplan = loopWaveplans.filter((candidate) => candidate.at <= action.at).at(-1);
              log(buildWaveReport({ loop: result.loop, action, planSkills: waveplan?.plan.skills ?? [] }));
              // 学习环：领航选过技能的波，按本波 verified && Δ>0 记 win / 否则 loss；幂等（已处理的波不重记）。
              if (loopWaveplans.length > 0) {
                try {
                  const outcomes = await (deps.persistOutcomes ?? persistSkillOutcomes)({ root: skillsRoot(), waveplans: loopWaveplans, actions: [action] });
                  if (outcomes.recordedOutcomes > 0) {
                    log(`[ops] 技能战绩已写回：${outcomes.recordedOutcomes} 条（${outcomes.processedWaves} 波）${outcomes.newlyDeprecated.length ? `，淘汰 ${outcomes.newlyDeprecated.join("/")}` : ""}`);
                  }
                } catch (error) {
                  log(`[ops] 技能战绩写回失败（不影响波次）：${String(error).slice(0, 160)}`);
                }
              }
              // 运营蒸馏源（P1-8c）：杠杆 / 技能战绩计数 → tier-1 经验，signature 去重、幂等；失败不影响波次。
              try {
                const lessons = distillOpsLessons({ loopId, actions: loopActions, waveplans: loopWaveplans, now: now() });
                for (const item of lessons) await appendLesson(stateDir, item);
                if (lessons.length > 0) log(`[ops] 运营经验已蒸馏：${lessons.length} 条（tier 1，待人工确认）`);
              } catch (error) {
                log(`[ops] 运营经验蒸馏失败（不影响波次）：${String(error).slice(0, 160)}`);
              }
            }
            entry.outcome = "ran";
          }
        }
      }
    } finally {
      await release?.();
    }
  } catch (error) {
    entry.outcome = "error";
    entry.detail = error instanceof Error ? error.message : String(error);
  }
  await appendOpsSchedule(stateDir, entry);
  return entry;
}
