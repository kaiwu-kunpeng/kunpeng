import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CliRunner } from "../agent/cli-runner.js";
import type { AgentRequest } from "../agent/runner.js";
import { searchLessons, type LessonEntry } from "../knowledge/lesson-store.js";
import { resolveProjectStateDir } from "../project/state-resolve.js";
import {
  allowsImplicitInvocation,
  searchSkills,
  skillsRoot as defaultSkillsRoot,
  type SkillEntry,
} from "../skills/registry.js";
import { extractFirstJsonObject } from "../util/extract-json.js";
import { readActions, type OpsAction } from "./action-ledger.js";
import { recipeRegistry } from "./recipe.js";
import { LoopStore } from "./store.js";
import type { LoopDef } from "./types.js";
import { readWaveplans, skillBattleStats, type SkillStat } from "./wave-report.js";

export interface WavePlan {
  lever: string;
  target?: string;
  skills: string[];
  waveGoal: string;
  stopLoss: string;
  reason: string;
}

export interface SkillCandidate {
  id: string;
  name: string;
  description: string;
}

export function selectImplicitSkillCandidates(skills: SkillEntry[]): SkillEntry[] {
  const candidates = skills.filter(allowsImplicitInvocation);
  if (candidates.length > 30) {
    candidates.sort((left, right) =>
      (right.usage?.activations ?? 0) - (left.usage?.activations ?? 0)
    );
  }
  return candidates.slice(0, 30);
}

interface PilotRunner {
  run(req: unknown): Promise<{ text: string }>;
}

export interface PilotDeps {
  runner?: PilotRunner;
  store?: Pick<LoopStore, "read" | "setNext">;
  skillsRoot?: string;
  stateDir?: string;
  apply?: boolean;
  /** 测试注入：覆盖「该 loop 的 recipe 是否消费技能」判定；生产按 recipeRegistry[loop.recipe].acceptsSkills（未声明当 true）。 */
  acceptsSkills?: boolean;
}

/** recipe 不吃技能就不给候选：领航别再给 geo-sweep 这类纯监测波选技能。 */
export function recipeAcceptsSkills(recipeId: string, override?: boolean): boolean {
  if (override !== undefined) return override;
  return recipeRegistry[recipeId]?.acceptsSkills !== false;
}

interface PromptLever {
  id: string;
  note: string;
}

function promptLevers(loop: LoopDef): PromptLever[] {
  return (loop.levers as unknown[]).flatMap((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    const lever = value as Record<string, unknown>;
    const id = typeof lever.id === "string"
      ? lever.id
      : typeof lever.lever === "string"
        ? lever.lever
        : undefined;
    if (!id) return [];
    const note = typeof lever.note === "string"
      ? lever.note
      : typeof lever.label === "string"
        ? lever.label
        : typeof lever.status === "string"
          ? lever.status
          : "";
    return [{ id, note }];
  });
}

export function buildPilotPrompt(
  loop: LoopDef,
  recent: OpsAction[],
  candidates: SkillCandidate[],
  skillStats?: Record<string, SkillStat>,
  lessons: readonly LessonEntry[] = [],
): string {
  const goal = loop.goal
    ? `正式目标: target=${loop.goal.target}; direction=${loop.goal.direction ?? "up"}`
    : "无正式目标,以指标提升为准";
  const actions = recent.slice(-10).map((action) =>
    `- lever=${action.lever}; subject=${action.subject}; metricDelta=${action.metricDelta}; verified=${String(action.verified)}`,
  );
  const skills = candidates.map((candidate) => {
    const battle = skillStats?.[candidate.id] ?? { picked: 0, wins: 0 };
    const battleText = skillStats ? `; 战绩 ${battle.picked}/${battle.wins} (picked/wins)` : "";
    return `- ${candidate.id}: ${candidate.description}${battleText}`;
  });
  const levers = promptLevers(loop).map((lever) => `- ${lever.id}: ${lever.note}`);

  return [
    "你是 Ops Pilot，请为当前 loop 选择下一波运营动作。",
    `Loop: ${loop.id} / ${loop.name}`,
    `指标: key=${loop.metric.key}; label=${loop.metric.label}; current=${loop.metric.current}`,
    goal,
    "最近运营动作台账(最多10条):",
    ...(actions.length > 0 ? actions : ["- (无)"]),
    "候选技能(id: description):",
    ...(skills.length > 0 ? skills : ["- (无)"]),
    "可选 lever(id: note):",
    ...(levers.length > 0 ? levers : ["- (无)"]),
    ...(skillStats ? ["优先考虑战绩好的技能,但允许尝试新技能。"] : []),
    ...(lessons.length > 0
      ? [
          "近期教训",
          "以下是过往教训,先判断是否适用再决定采纳:",
          ...lessons.slice(0, 2).map((lesson) =>
            `- ${lesson.title} [${lesson.polarity}]: ${lesson.content} (Evidence: ${lesson.evidence})`,
          ),
        ]
      : []),
    "只输出一个 JSON 对象，字段为 lever/target/skills/waveGoal/stopLoss/reason。",
    "skills 只能取候选 id，lever 只能取清单内值。不要输出 Markdown 或额外说明。",
  ].join("\n");
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function parseWavePlan(
  text: string,
  valid: { levers: string[]; skills: string[] },
): WavePlan | { error: string } {
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = objectRecord(JSON.parse(extractFirstJsonObject(text)) as unknown);
  } catch (error) {
    return { error: `无法解析 WavePlan: ${(error as Error).message}` };
  }
  if (!parsed) return { error: "WavePlan 必须是 JSON 对象" };

  const lever = parsed.lever;
  if (typeof lever !== "string" || !valid.levers.includes(lever)) {
    return { error: `未知 lever: ${typeof lever === "string" ? lever : String(lever)}` };
  }

  const validSkills = new Set(valid.skills);
  const selectedSkills = Array.isArray(parsed.skills)
    ? parsed.skills.filter((skill): skill is string => typeof skill === "string" && validSkills.has(skill))
    : [];
  const target = typeof parsed.target === "string" ? parsed.target : undefined;

  return {
    lever,
    ...(target !== undefined ? { target } : {}),
    skills: selectedSkills,
    waveGoal: typeof parsed.waveGoal === "string" ? parsed.waveGoal : "",
    stopLoss: typeof parsed.stopLoss === "string" ? parsed.stopLoss : "",
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
  };
}

function createDefaultRunner(): PilotRunner {
  const runner = new CliRunner();
  return {
    run: async (req) => {
      const result = await runner.run(req as AgentRequest);
      return { text: result.text };
    },
  };
}

export async function pilotNext(
  loopId: string,
  deps: PilotDeps = {},
): Promise<{ plan: WavePlan; applied: boolean }> {
  const repoRoot = process.cwd();
  const stateDir = deps.stateDir ?? resolveProjectStateDir(repoRoot);
  const store = deps.store ?? new LoopStore(join(repoRoot, ".kunpeng", "loops"));
  const loop = await store.read(loopId);
  if (!loop) throw new Error(`loop not found: ${loopId}`);

  let allActions: OpsAction[] = [];
  let actionsAvailable = false;
  try {
    allActions = await readActions(stateDir);
    actionsAvailable = allActions.length > 0;
  } catch {
    // Historical evidence enriches a decision, but must never block one.
  }
  const recent = allActions.filter((action) => action.loopId === loopId).slice(-10);
  let skillStats: Record<string, SkillStat> | undefined;
  try {
    const waveplans = await readWaveplans(stateDir);
    if (actionsAvailable && waveplans.length > 0) {
      const calculated = skillBattleStats(waveplans, allActions);
      if (Object.keys(calculated).length > 0) skillStats = calculated;
    }
  } catch {
    // Keep the pre-history prompt when waveplan evidence cannot be read.
  }
  const matchingSkills = recipeAcceptsSkills(loop.recipe, deps.acceptsSkills)
    ? searchSkills(deps.skillsRoot ?? defaultSkillsRoot(), "", { enabled: true, project: loop.projectId })
    : [];
  const candidates: SkillCandidate[] = selectImplicitSkillCandidates(matchingSkills).map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
  }));
  const leverIds = promptLevers(loop).map((lever) => lever.id);
  const lessonQuery = [
    loop.goal ? `target ${loop.goal.target} ${loop.goal.direction ?? "up"} ${loop.goal.note ?? ""}` : "",
    loop.nextLever ? `${loop.nextLever.lever} ${loop.nextLever.target ?? ""} ${loop.nextLever.note ?? ""}` : "",
  ].filter(Boolean).join(" ");
  // 运营波次只吃已验真(trustTier 2)的经验；自动蒸馏的 tier 1 需人工确认后才参与决策（安全1⑥）
  const lessons = await searchLessons(stateDir, lessonQuery, 2, { minTrustTier: 2 });
  const prompt = buildPilotPrompt(loop, recent, candidates, skillStats, lessons);
  const runner = deps.runner ?? createDefaultRunner();
  const result = await runner.run({
    stage: "design",
    system: "你是目标驱动的运营决策器。严格遵守输入中的 JSON 输出契约。",
    input: prompt,
    tools: [],
  });
  const plan = parseWavePlan(result.text, {
    levers: leverIds,
    skills: candidates.map((candidate) => candidate.id),
  });
  if ("error" in plan) {
    throw new Error(`Ops Pilot 解析失败: ${plan.error}; 原始模型文本: ${result.text.slice(0, 200)}`);
  }

  if (deps.apply === false) return { plan, applied: false };

  const note = `${plan.waveGoal} | skills:${plan.skills.join(",")} | stopLoss:${plan.stopLoss}`;
  await store.setNext(loopId, {
    lever: plan.lever,
    ...(plan.target !== undefined ? { target: plan.target } : {}),
    note,
    ...(plan.skills.length > 0 ? { skills: plan.skills } : {}),
  });
  await mkdir(join(stateDir, "ops"), { recursive: true });
  await appendFile(
    join(stateDir, "ops", "waveplans.jsonl"),
    `${JSON.stringify({ at: Date.now(), loopId, plan })}\n`,
    "utf8",
  );
  return { plan, applied: true };
}
