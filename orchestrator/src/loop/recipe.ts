import type { ActionLevel, EvidenceKind, Lever, LoopDef } from "./types.js";

export interface WaveResult {
  metricBefore: number;
  metricAfter: number;
  metricDelta: number;
  commit?: string;
  deploy?: string;
  verified: boolean;
  level?: ActionLevel;
  outboxId?: string;
  evidence?: string;
  evidenceKind?: EvidenceKind;
  goalMetricCurrent?: number;
  instrumentBroken?: boolean;
  detail?: string;
  gotchas?: string[];
  skillsActivated?: string[];
}

export interface WeakPoint {
  target: string;
  reason: string;
  urgency: number;
  expectedDelta?: number;
}

export interface LoopRecipe {
  id: string;
  defaultEvidenceKind?: EvidenceKind;
  listLevers(def: LoopDef): Lever[];
  readMetric(def: LoopDef): Promise<number>;
  allowsUnlistedLever?: (lever: string) => boolean;
  runWave?(loop: LoopDef, lever: string, target: string | undefined, deps?: unknown): Promise<WaveResult>;
  discoverWeakPoints?(loop: LoopDef, deps?: unknown): Promise<WeakPoint[]>;
  /** 杠杆未声明等级时使用的缺省动作等级；缺省也未提供时视为未定级。 */
  defaultLeverLevel?(leverId: string): ActionLevel | undefined;
  /** 这个 recipe 的 runWave 是否真的消费领航选的技能（nextLever.skills）。
   *  缺省当作消费（兼容未声明的 recipe）；明确 false 的（纯抓取 / 监测类）领航不再给技能候选，省一次无效 LLM 选型（审计 G4：4/5 个 recipe 对技能无感）。 */
  acceptsSkills?: boolean;
}

/** 杠杆声明优先，其次使用 recipe 的缺省等级。 */
export function resolveWaveLevel(loop: LoopDef, leverId: string, recipe: Pick<LoopRecipe, "defaultLeverLevel">): ActionLevel | undefined {
  const declared = loop.levers.find((lever) => lever.id === leverId)?.level;
  if (declared) return declared;
  return recipe.defaultLeverLevel?.(leverId);
}

/** 按杠杆名缺省定级：只读类 L0、对外推送类 L3、其余改动类 L2。 */
export function defaultLeverLevelByName(leverId: string): ActionLevel {
  if (/crawl|sweep|scan|audit|monitor|capture|read|watch/i.test(leverId)) return "L0";
  if (/indexnow|submit|publish|deploy|push|release|send/i.test(leverId)) return "L3";
  return "L2";
}

export const recipeRegistry: Record<string, LoopRecipe> = {};

export function getRecipe(id: string): LoopRecipe {
  const recipe = recipeRegistry[id];
  if (!recipe) throw new Error(`unknown loop recipe: ${id}`);
  return recipe;
}
