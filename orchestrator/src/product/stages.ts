import type { AgentRunner } from "../agent/runner.js";
import { extractFirstJsonObject } from "../util/extract-json.js";
import type {
  NorthStar,
  OpportunityNode,
  OpportunitySolutionTree,
  ProductDefinition,
  ProductDiscovery,
  ProductOpportunity,
  ProductValidation,
  ProductValidationDecision,
  ProductValidationSignal,
  SolutionNode,
  ShapedPitch,
} from "./contract.js";
import { buildOstPrompt } from "./ost.js";

const DISCOVER_PARSE_ERROR = "discoverProduct: 无法从 agent 输出解析 DISCOVER 产物";
const OST_PARSE_ERROR = "discoverOst: 无法从 agent 输出解析 OST 树";
const SHAPE_PARSE_ERROR = "shapeProduct: 无法从 agent 输出解析 SHAPE 产物";

function textFromAgentOutput(out: unknown): string | undefined {
  if (typeof out === "string") return out;
  if (!out || typeof out !== "object") return undefined;

  const maybe = out as { output?: unknown; text?: unknown };
  if (typeof maybe.output === "string") return maybe.output;
  if (typeof maybe.text === "string") return maybe.text;
  return undefined;
}

function parseJsonObject(text: string, errorMessage: string): Record<string, unknown> {
  let json: string;
  try {
    json = extractFirstJsonObject(text);
  } catch {
    throw new Error(errorMessage);
  }

  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new Error(errorMessage);
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function calculateOpportunityScore(importance: number, satisfaction: number): number {
  return importance + Math.max(importance - satisfaction, 0);
}

function normalizeOpportunities(value: unknown): ProductOpportunity[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .map((item) => {
      const importance = finiteNumber(item.importance);
      const satisfaction = finiteNumber(item.satisfaction);
      return {
        outcome: typeof item.outcome === "string" ? item.outcome : "",
        importance,
        satisfaction,
        opportunityScore: calculateOpportunityScore(importance, satisfaction),
      };
    });
}

export function buildDiscoverPrompt(definition: ProductDefinition): string {
  return [
    "请把 DEFINE 的 PR/FAQ 产品定义推进到 DISCOVER 阶段。",
    "目标：输出无解法 job 陈述、目标人群、当前替代方案、机会评分树。机会评分只输出 importance/satisfaction 数字；opportunityScore 由系统确定性计算，不信任 agent 字段。",
    "合成用户只能用于生成和排序假设，syntheticEvidence 必须为 true，不能冒充真实验证。",
    "",
    `idea: ${definition.idea}`,
    `problem: ${definition.problem}`,
    `users: ${definition.users.join(", ")}`,
    "stories:",
    ...definition.stories.map((story) => `- ${story}`),
    "acceptance:",
    ...definition.acceptance.map((item) => `- ${item}`),
    "",
    '只返回严格单行 JSON，无解释、无 markdown 包裹，形状必须为 {"jobStatement":string,"targetUsers":string[],"alternatives":string[],"opportunities":[{"outcome":string,"importance":number,"satisfaction":number}],"syntheticEvidence":boolean}',
  ].join("\n");
}

export async function discoverProduct(
  definition: ProductDefinition,
  runner: AgentRunner,
): Promise<ProductDiscovery> {
  const out = (await runner.run({
    stage: "spec",
    system: "",
    input: buildDiscoverPrompt(definition),
    tools: [],
  })) as unknown;

  const text = textFromAgentOutput(out);
  if (text === undefined) throw new Error(DISCOVER_PARSE_ERROR);

  const obj = parseJsonObject(text, DISCOVER_PARSE_ERROR);
  return {
    definition,
    jobStatement: typeof obj.jobStatement === "string" ? obj.jobStatement : "",
    targetUsers: stringArray(obj.targetUsers),
    alternatives: stringArray(obj.alternatives),
    opportunities: normalizeOpportunities(obj.opportunities),
    syntheticEvidence: obj.syntheticEvidence === false ? false : true,
  };
}

/** 把 agent 输出解析成 OpportunitySolutionTree(容错规范化:缺字段给安全默认)。 */
export function parseOstTree(text: string): OpportunitySolutionTree {
  const obj = parseJsonObject(text, OST_PARSE_ERROR);
  const ns = (obj.northStar && typeof obj.northStar === "object" ? obj.northStar : {}) as Record<string, unknown>;
  const northStar: NorthStar = {
    outcome: typeof ns.outcome === "string" ? ns.outcome : "",
    metric: typeof ns.metric === "string" ? ns.metric : "",
  };
  const opportunities: OpportunityNode[] = Array.isArray(obj.opportunities)
    ? obj.opportunities
        .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
        .map((o) => ({
          id: typeof o.id === "string" ? o.id : "",
          statement: typeof o.statement === "string" ? o.statement : "",
          source: typeof o.source === "string" ? o.source : "",
          evidence: o.evidence === "real" ? "real" : "synthetic",
          parentId: typeof o.parentId === "string" ? o.parentId : undefined,
        }))
    : [];
  const solutions: SolutionNode[] = Array.isArray(obj.solutions)
    ? obj.solutions
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
        .map((s) => ({
          id: typeof s.id === "string" ? s.id : "",
          opportunityId: typeof s.opportunityId === "string" ? s.opportunityId : "",
          idea: typeof s.idea === "string" ? s.idea : "",
        }))
    : [];
  return { northStar, opportunities, solutions };
}

/** 基于 DISCOVER 产物跑 buildOstPrompt,产出机会-解法树。 */
export async function discoverOst(
  discovery: ProductDiscovery,
  runner: AgentRunner,
): Promise<OpportunitySolutionTree> {
  const out = (await runner.run({
    stage: "spec",
    system: "",
    input: buildOstPrompt(discovery),
    tools: [],
  })) as unknown;

  const text = textFromAgentOutput(out);
  if (text === undefined) throw new Error(OST_PARSE_ERROR);
  return parseOstTree(text);
}

export function buildShapePrompt(discovery: ProductDiscovery): string {
  return [
    "请把 DISCOVER 产物推进到 SHAPE 阶段，输出 shaped pitch。",
    "必须固定 appetite，列出 buildScope、rabbitHoles、noGos 和 successMetrics；范围有界，避免把探索项塞进构建范围。",
    "DISCOVER:",
    JSON.stringify(discovery),
    "",
    '只返回严格单行 JSON，无解释、无 markdown 包裹，形状必须为 {"title":string,"appetite":string,"problem":string,"solution":string,"buildScope":string[],"rabbitHoles":string[],"noGos":string[],"successMetrics":string[]}',
  ].join("\n");
}

export async function shapeProduct(discovery: ProductDiscovery, runner: AgentRunner): Promise<ShapedPitch> {
  const out = (await runner.run({
    stage: "design",
    system: "",
    input: buildShapePrompt(discovery),
    tools: [],
  })) as unknown;

  const text = textFromAgentOutput(out);
  if (text === undefined) throw new Error(SHAPE_PARSE_ERROR);

  const obj = parseJsonObject(text, SHAPE_PARSE_ERROR);
  return {
    title: typeof obj.title === "string" ? obj.title : "",
    appetite: typeof obj.appetite === "string" ? obj.appetite : "",
    problem: typeof obj.problem === "string" ? obj.problem : "",
    solution: typeof obj.solution === "string" ? obj.solution : "",
    buildScope: stringArray(obj.buildScope),
    rabbitHoles: stringArray(obj.rabbitHoles),
    noGos: stringArray(obj.noGos),
    successMetrics: stringArray(obj.successMetrics),
  };
}

function hasRealSignal(signals: ProductValidationSignal[]): boolean {
  return signals.some((signal) => !signal.synthetic);
}

function normalizeDecision(decision: ProductValidationDecision | undefined): ProductValidationDecision {
  return decision ?? "inconclusive";
}

export function validateProduct(input: {
  pitch: ShapedPitch;
  hypotheses: string[];
  signals: ProductValidationSignal[];
  decision?: ProductValidationDecision;
  rationale?: string;
}): ProductValidation {
  const realSignalPresent = hasRealSignal(input.signals);
  const decision = realSignalPresent ? normalizeDecision(input.decision) : "inconclusive";
  return {
    hypotheses: [...input.hypotheses],
    signals: input.signals.map((signal) => ({ ...signal })),
    decision,
    rationale: realSignalPresent
      ? (input.rationale ?? "")
      : "缺少真实信号；合成用户或空信号不能裁定 pivot/persevere",
    requiresHumanGate: true,
  };
}
