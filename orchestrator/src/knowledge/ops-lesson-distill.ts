import type { OpsAction } from "../loop/action-ledger.js";
import { skillBattleStats, type StoredWaveplan } from "../loop/wave-report.js";
import type { LessonEntry } from "./lesson-store.js";

/** 运营蒸馏源（审计 A3 G4 / P1-8c）：从 actions.jsonl + waveplans 用纯计数出 tier-1 经验，不调 LLM（C8 确定性优先）。 */
export const OPS_LESSON_MIN_WAVES = 3;
/** 胜率 ≥ 2/3 记成功经验；全败记失败经验；中间地带不出经验（噪声）。 */
export const OPS_LESSON_WIN_RATIO = 2 / 3;

export interface DistillOpsLessonsInput {
  loopId: string;
  actions: readonly OpsAction[];
  waveplans: readonly StoredWaveplan[];
  now: number;
  minWaves?: number;
}

const won = (action: OpsAction): boolean => action.verified && action.metricDelta > 0;
const actionKey = (action: OpsAction): string => `${action.loopId}@${action.at}`;

function lesson(input: {
  kind: "lever" | "skill"; loopId: string; subject: string; polarity: "success" | "failure"; wins: number; total: number;
  sourceIds: string[]; projectId?: string; now: number; lastDelta?: number;
}): LessonEntry {
  const what = input.kind === "lever" ? `杠杆「${input.subject}」` : `技能「${input.subject}」`;
  const title = input.polarity === "success"
    ? `${what} 在 loop ${input.loopId} 上多数波有进展（${input.wins}/${input.total}）`
    : `${what} 在 loop ${input.loopId} 上连续无进展（${input.wins}/${input.total}）`;
  const content = input.polarity === "success"
    ? `下一波优先续用${what}；若 Δ 转负再换。`
    : `别再给 loop ${input.loopId} 选${what}：${input.total} 波 ${input.wins} 胜，换杠杆或换技能组合。`;
  return {
    id: `ops-${input.kind}-${input.loopId}-${input.subject}-${input.polarity}`,
    title,
    description: `${input.kind === "lever" ? "运营杠杆" : "领航技能"}战绩计数（自动蒸馏，tier 1，需人工确认后参与决策）`,
    content,
    polarity: input.polarity,
    evidence: `${input.wins} 胜 / ${input.total - input.wins} 负${input.lastDelta !== undefined ? `，最近一波 Δ=${input.lastDelta}` : ""}`,
    signature: `ops-${input.kind}:${input.loopId}:${input.subject}:${input.polarity}`,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    sourceIds: input.sourceIds,
    trustTier: 1,
    stats: { injected: 0, wins: 0, losses: 0 },
    createdAt: input.now,
  };
}

/** 杠杆维度：同 loop 同杠杆 ≥ minWaves 波，胜率 ≥ 2/3 → success；0 胜 → failure。技能维度：领航选过的技能同口径。 */
export function distillOpsLessons(input: DistillOpsLessonsInput): LessonEntry[] {
  const minWaves = input.minWaves ?? OPS_LESSON_MIN_WAVES;
  const mine = input.actions.filter((a) => a.loopId === input.loopId).sort((a, b) => a.at - b.at);
  const projectId = mine[0]?.projectId;
  const out: LessonEntry[] = [];

  const byLever = new Map<string, OpsAction[]>();
  for (const action of mine) byLever.set(action.lever, [...(byLever.get(action.lever) ?? []), action]);
  for (const [lever, actions] of [...byLever.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (actions.length < minWaves) continue;
    const wins = actions.filter(won).length;
    const polarity = wins / actions.length >= OPS_LESSON_WIN_RATIO ? "success" : wins === 0 ? "failure" : undefined;
    if (!polarity) continue;
    out.push(lesson({ kind: "lever", loopId: input.loopId, subject: lever, polarity, wins, total: actions.length, sourceIds: actions.map(actionKey), projectId, now: input.now, lastDelta: actions.at(-1)!.metricDelta }));
  }

  const plans = input.waveplans.filter((w) => w.loopId === input.loopId);
  const stats = skillBattleStats([...plans], [...mine]);
  for (const [skill, stat] of Object.entries(stats).sort(([a], [b]) => a.localeCompare(b))) {
    if (stat.picked < minWaves) continue;
    const polarity = stat.wins / stat.picked >= OPS_LESSON_WIN_RATIO ? "success" : stat.wins === 0 ? "failure" : undefined;
    if (!polarity) continue;
    const sourceIds = plans.filter((w) => w.plan.skills.includes(skill)).map((w) => `${w.loopId}@plan:${w.at}`);
    out.push(lesson({ kind: "skill", loopId: input.loopId, subject: skill, polarity, wins: stat.wins, total: stat.picked, sourceIds, projectId, now: input.now }));
  }
  return out;
}
