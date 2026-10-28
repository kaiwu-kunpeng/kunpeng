import type { InterviewSession, ProductDefinition } from "./contract.js";
import { buildDefineFaqAnswers } from "./interview.js";
import type { AgentRunner } from "../agent/runner.js";
import { extractFirstJsonObject } from "../util/extract-json.js";

const PARSE_ERROR = "summarizeDefinition: 无法从 agent 输出解析产品定义";

function textFromAgentOutput(out: unknown): string | undefined {
  if (typeof out === "string") return out;
  if (!out || typeof out !== "object") return undefined;

  const maybe = out as { output?: unknown; text?: unknown };
  if (typeof maybe.output === "string") return maybe.output;
  if (typeof maybe.text === "string") return maybe.text;
  return undefined;
}

function parseJsonObject(text: string): unknown {
  let json: string;
  try {
    json = extractFirstJsonObject(text);
  } catch {
    throw new Error(PARSE_ERROR);
  }

  try {
    return JSON.parse(json);
  } catch {
    throw new Error(PARSE_ERROR);
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function buildPrompt(session: InterviewSession): string {
  const qa = buildDefineFaqAnswers(session).map((item, index) => {
    return `${index + 1}. [${item.anchor}] ${item.label}\n问：${item.question}\n答：${item.answer}`;
  }).join("\n\n");

  return [
    "请根据产品访谈内容汇总 PR-FAQ 写作驱动、JTBD 痛点驱动的产品定义。",
    `产品想法：${session.idea}`,
    "",
    "访谈问答：",
    qa,
    "",
    "problem 必须写具体客户 + 具体痛点场景，禁止泛泛而谈，尤其不要写“提升效率”这类无信息量套话。",
    "必须给出 jobStatement，使用 JTBD 句式：当<情境>时<用户>想<动机>以便<结果>。",
    "必须给出 nonGoals，明确不做什么，用来压住镀金和范围蔓延。",
    "",
    '只返回严格单行 JSON，无解释、无 markdown 包裹，形状必须为 {"problem":string,"jobStatement":string,"users":string[],"stories":string[],"acceptance":string[],"nonGoals":string[]}',
  ].join("\n");
}

export async function summarizeDefinition(
  session: InterviewSession,
  runner: AgentRunner,
): Promise<ProductDefinition> {
  const out = (await runner.run({
    stage: "spec",
    system: "",
    input: buildPrompt(session),
    tools: [],
  })) as unknown;

  const text = textFromAgentOutput(out);
  if (text === undefined) throw new Error(PARSE_ERROR);

  const parsed = parseJsonObject(text);
  const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};

  return {
    idea: session.idea,
    problem: typeof obj.problem === "string" ? obj.problem : "",
    jobStatement: typeof obj.jobStatement === "string" ? obj.jobStatement : "",
    users: stringArray(obj.users),
    stories: stringArray(obj.stories),
    acceptance: stringArray(obj.acceptance),
    nonGoals: stringArray(obj.nonGoals),
  };
}

export async function completeInterview(
  session: InterviewSession,
  runner: AgentRunner,
): Promise<InterviewSession> {
  const definition = await summarizeDefinition(session, runner);
  return { ...session, status: "done", definition };
}
