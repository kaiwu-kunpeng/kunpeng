import type { AgentRunner } from "../agent/runner.js";
import { extractFirstJsonObject } from "../util/extract-json.js";
import { PRODUCT_DEFINE_FAQ_ANCHORS, type ProductDefinition } from "./contract.js";

const PARSE_ERROR = "autoDefineProduct: 无法从 agent 输出解析产品定义";

function textFromAgentOutput(out: unknown): string | undefined {
  if (typeof out === "string") return out;
  if (!out || typeof out !== "object") return undefined;

  const maybe = out as { output?: unknown; text?: unknown };
  if (typeof maybe.output === "string") return maybe.output;
  if (typeof maybe.text === "string") return maybe.text;
  return undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseDefinition(text: string): Omit<ProductDefinition, "idea"> {
  let json: string;
  try {
    json = extractFirstJsonObject(text);
  } catch {
    throw new Error(PARSE_ERROR);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(PARSE_ERROR);
  }

  const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  return {
    problem: typeof obj.problem === "string" ? obj.problem : "",
    jobStatement: typeof obj.jobStatement === "string" ? obj.jobStatement : "",
    users: stringArray(obj.users),
    stories: stringArray(obj.stories),
    acceptance: stringArray(obj.acceptance),
    nonGoals: stringArray(obj.nonGoals),
  };
}

export function buildAutoDefinePrompt(idea: string): string {
  const anchors = PRODUCT_DEFINE_FAQ_ANCHORS.map((item) => {
    return `- [${item.anchor}] ${item.label}：${item.question}`;
  }).join("\n");

  return [
    "请把一句话产品想法自动澄清为 PR-FAQ 写作驱动、JTBD 痛点驱动的产品定义，不要反问用户。",
    `一句话产品想法：${idea}`,
    "",
    "必须覆盖这些 PR FAQ 锚点：",
    anchors,
    "",
    "problem 必须写具体客户 + 具体痛点场景，禁止泛泛而谈，尤其不要写“提升效率”这类无信息量套话。",
    "必须给出 jobStatement，使用 JTBD 句式：当<情境>时<用户>想<动机>以便<结果>。",
    "必须给出 nonGoals，明确不做什么，用来压住镀金和范围蔓延。",
    "",
    '只返回严格单行 JSON，无解释、无 markdown 包裹，形状必须为 {"problem":string,"jobStatement":string,"users":string[],"stories":string[],"acceptance":string[],"nonGoals":string[]}',
  ].join("\n");
}

export async function autoDefineProduct(idea: string, runner: AgentRunner): Promise<ProductDefinition> {
  const MAX_ATTEMPTS = 2;
  let lastErr: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const out = (await runner.run({
        stage: "spec",
        system: "",
        input: buildAutoDefinePrompt(idea),
        tools: [],
      })) as unknown;

      const text = textFromAgentOutput(out);
      if (text === undefined) throw new Error(PARSE_ERROR);

      return { idea, ...parseDefinition(text) };
    } catch (error) {
      lastErr = error;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(PARSE_ERROR);
}
