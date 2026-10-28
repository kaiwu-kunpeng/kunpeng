import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OpsAction } from "./action-ledger.js";
import { listSkills, recordSkillOutcome, type SkillEntry } from "../skills/registry.js";

export interface SkillStat {
  picked: number;
  wins: number;
}

export interface StoredWaveplan {
  at: number;
  loopId: string;
  plan: { skills: string[] };
}

export interface PersistSkillOutcomesInput {
  root: string;
  waveplans: StoredWaveplan | StoredWaveplan[];
  actions: OpsAction | OpsAction[];
}

export interface PersistSkillOutcomesResult {
  processedWaves: number;
  recordedOutcomes: number;
  newlyDeprecated: string[];
}

interface PersistedOutcomeWaves {
  processed: string[];
}

export function skillBattleStats(
  waveplans: StoredWaveplan[],
  actions: OpsAction[],
): Record<string, SkillStat> {
  const stats = new Map<string, SkillStat>();

  for (const waveplan of waveplans) {
    let firstAction: OpsAction | undefined;
    for (const action of actions) {
      if (action.loopId !== waveplan.loopId || action.at < waveplan.at) continue;
      if (!firstAction || action.at < firstAction.at) firstAction = action;
    }

    const won = firstAction?.verified === true && firstAction.metricDelta > 0;
    for (const skill of waveplan.plan.skills) {
      const current = stats.get(skill) ?? { picked: 0, wins: 0 };
      stats.set(skill, {
        picked: current.picked + 1,
        wins: current.wins + (won ? 1 : 0),
      });
    }
  }

  return Object.fromEntries(stats);
}

function firstActionForWaveplan(waveplan: StoredWaveplan, actions: OpsAction[]): OpsAction | undefined {
  let firstAction: OpsAction | undefined;
  for (const action of actions) {
    if (action.loopId !== waveplan.loopId || action.at < waveplan.at) continue;
    if (!firstAction || action.at < firstAction.at) firstAction = action;
  }
  return firstAction;
}

function outcomeWaveKey(waveplan: StoredWaveplan, action: OpsAction): string {
  return `${waveplan.loopId}:${waveplan.at}:${action.at}`;
}

function outcomeWavesPath(root: string): string {
  return join(root, "outcome-waves.json");
}

async function readPersistedOutcomeWaves(root: string): Promise<Set<string>> {
  let contents: string;
  try {
    contents = await readFile(outcomeWavesPath(root), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw error;
  }

  const parsed = JSON.parse(contents) as unknown;
  if (
    typeof parsed !== "object"
    || parsed === null
    || Array.isArray(parsed)
    || !Array.isArray((parsed as { processed?: unknown }).processed)
    || !(parsed as { processed: unknown[] }).processed.every((key) => typeof key === "string")
  ) {
    throw new Error("技能战绩判重状态格式无效");
  }
  return new Set((parsed as PersistedOutcomeWaves).processed);
}

async function writePersistedOutcomeWaves(root: string, processed: Set<string>): Promise<void> {
  await mkdir(root, { recursive: true });
  const path = outcomeWavesPath(root);
  const tmp = join(root, `.outcome-waves.json.${process.pid}.${Date.now()}.tmp`);
  const state: PersistedOutcomeWaves = { processed: [...processed].sort() };
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

function resolvePickedSkill(skills: SkillEntry[], picked: string): SkillEntry | undefined {
  const byId = skills.find((skill) => skill.id === picked);
  if (byId) return byId;
  const byName = skills.filter((skill) => skill.name === picked);
  if (byName.length > 1) throw new Error(`技能标识不唯一: ${picked}`);
  return byName[0];
}

export async function persistSkillOutcomes(input: PersistSkillOutcomesInput): Promise<PersistSkillOutcomesResult>;
export async function persistSkillOutcomes(
  root: string,
  waveplans: StoredWaveplan | StoredWaveplan[],
  actions: OpsAction | OpsAction[],
): Promise<PersistSkillOutcomesResult>;
export async function persistSkillOutcomes(
  rootOrInput: string | PersistSkillOutcomesInput,
  waveplansArg?: StoredWaveplan | StoredWaveplan[],
  actionsArg?: OpsAction | OpsAction[],
): Promise<PersistSkillOutcomesResult> {
  const root = typeof rootOrInput === "string" ? rootOrInput : rootOrInput.root;
  const waveplansInput = typeof rootOrInput === "string" ? waveplansArg : rootOrInput.waveplans;
  const actionsInput = typeof rootOrInput === "string" ? actionsArg : rootOrInput.actions;
  if (waveplansInput === undefined || actionsInput === undefined) {
    throw new Error("persistSkillOutcomes 缺少 waveplans 或 actions");
  }

  const waveplans = Array.isArray(waveplansInput) ? waveplansInput : [waveplansInput];
  const actions = Array.isArray(actionsInput) ? actionsInput : [actionsInput];
  const processed = await readPersistedOutcomeWaves(root);
  const skills = listSkills(root);
  const newlyDeprecated = new Set<string>();
  let processedWaves = 0;
  let recordedOutcomes = 0;

  for (const waveplan of waveplans) {
    const action = firstActionForWaveplan(waveplan, actions);
    if (!action) continue;
    const key = outcomeWaveKey(waveplan, action);
    if (processed.has(key)) continue;

    const pickedSkills = new Map<string, SkillEntry>();
    for (const picked of waveplan.plan.skills) {
      const skill = resolvePickedSkill(skills, picked);
      if (skill) pickedSkills.set(skill.id, skill);
    }

    const outcome = action.verified === true && action.metricDelta > 0 ? "win" : "loss";
    for (const skill of pickedSkills.values()) {
      const result = await recordSkillOutcome(root, skill.id, outcome, action.at);
      recordedOutcomes += 1;
      if (result.newlyDeprecated) newlyDeprecated.add(skill.id);
    }

    processed.add(key);
    await writePersistedOutcomeWaves(root, processed);
    processedWaves += 1;
  }

  return {
    processedWaves,
    recordedOutcomes,
    newlyDeprecated: [...newlyDeprecated],
  };
}

function parseWaveplan(value: unknown): StoredWaveplan | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.at !== "number" || !Number.isFinite(record.at)) return undefined;
  if (typeof record.loopId !== "string") return undefined;
  if (typeof record.plan !== "object" || record.plan === null || Array.isArray(record.plan)) return undefined;
  const plan = record.plan as Record<string, unknown>;
  if (!Array.isArray(plan.skills) || !plan.skills.every((skill) => typeof skill === "string")) return undefined;
  return { at: record.at, loopId: record.loopId, plan: { skills: plan.skills } };
}

export async function readWaveplans(stateDir: string): Promise<StoredWaveplan[]> {
  let contents: string;
  try {
    contents = await readFile(join(stateDir, "ops", "waveplans.jsonl"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const waveplans: StoredWaveplan[] = [];
  for (const line of contents.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const waveplan = parseWaveplan(JSON.parse(line) as unknown);
      if (waveplan) waveplans.push(waveplan);
    } catch {
      // One corrupt JSONL row must not hide later valid waveplans.
    }
  }
  return waveplans.sort((left, right) => left.at - right.at);
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function buildWaveReport(input: {
  loop: {
    id: string;
    name: string;
    metric: { label: string; current: number };
    goal?: { target: number };
  };
  action: OpsAction;
  planSkills: string[];
}): string {
  const { loop, action, planSkills } = input;
  const before = action.metricAfter - action.metricDelta;
  const date = Number.isFinite(action.at)
    ? new Date(action.at).toISOString().slice(0, 10)
    : "日期未知";
  const actualSkills = Array.isArray(action.skills) ? action.skills : undefined;
  const reportedSkills = actualSkills ?? planSkills;
  const skills = reportedSkills.length > 0 ? reportedSkills.map((skill) => `- ${skill}`) : ["- (无)"];
  const missingSkills = planSkills.filter((skill) => !actualSkills?.includes(skill));
  const skillSource = actualSkills !== undefined
    ? `- 计划未送达: ${missingSkills.length > 0 ? missingSkills.join(", ") : "(无)"}`
    : "- 来源: 仅计划（该波无注入记录）";
  const goal = loop.goal
    ? [
        "",
        "## 目标进度",
        "",
        `- 当前 / 目标: ${action.metricAfter} / ${loop.goal.target}`,
        `- 进度: ${loop.goal.target === 0 ? 0 : ((action.metricAfter / loop.goal.target) * 100).toFixed(1)}%`,
      ]
    : [];

  return [
    `# ${loop.name} · 波报告 · ${date}`,
    "",
    `Loop: ${loop.id}`,
    "",
    "## 指标变化",
    "",
    `- ${loop.metric.label}: ${before} → ${action.metricAfter}`,
    `- delta: ${signed(action.metricDelta)}`,
    ...goal,
    "",
    "## 本波技能",
    "",
    ...skills,
    skillSource,
    "",
    "## 验证状态",
    "",
    `- verified: ${String(action.verified)}`,
    "",
  ].join("\n");
}
