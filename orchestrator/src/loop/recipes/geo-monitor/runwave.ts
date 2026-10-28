import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AgentRunner } from "../../../agent/runner.js";
import { CliRunner } from "../../../agent/cli-runner.js";
import { createTask as createStoredTask, listTasks as listStoredTasks } from "../../../task/store.js";
import type { WaveResult } from "../../recipe.js";
import type { LoopDef } from "../../types.js";
import {
  geoPrompt,
  parseGeoAnswer,
  summarizeGeoWave,
  type GeoAnswer,
  type GeoConfig,
} from "./core.js";

export interface GeoMonitorRunWaveDeps {
  agentRunner?: AgentRunner;
  repoPath?: string;
  skills?: string[];
  maxQuestions?: number;
  now?: number | (() => number);
  createTask?: CreateTaskFn;
  listTasks?: ListTasksFn;
}

interface ExistingTaskTitle {
  title: string;
}

interface GeoGapTaskDraft {
  title: string;
  type: string;
  projectId?: string;
  context: string;
  acceptanceCriteria: string[];
}

type CreateTaskFn = (root: string, task: GeoGapTaskDraft) => Promise<unknown>;
type ListTasksFn = (root: string) => Promise<readonly ExistingTaskTitle[]>;

function makeDefaultAgentRunner(deps: GeoMonitorRunWaveDeps): AgentRunner {
  return deps.agentRunner ?? new CliRunner();
}

function asDeps(deps: unknown): GeoMonitorRunWaveDeps {
  return typeof deps === "object" && deps !== null && !Array.isArray(deps)
    ? deps as GeoMonitorRunWaveDeps
    : {};
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseGeoConfig(raw: unknown, configPath: string): GeoConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`geo-monitor 配置格式错误: ${configPath}`);
  }

  const config = raw as Partial<GeoConfig>;
  if (
    !isStringArray(config.brandNames)
    || !isStringArray(config.brandDomains)
    || !isStringArray(config.questions)
  ) {
    throw new Error(`geo-monitor 配置格式错误: ${configPath}`);
  }

  return {
    brandNames: config.brandNames,
    brandDomains: config.brandDomains,
    questions: config.questions,
  };
}

function readGeoConfig(repoPath: string): GeoConfig {
  const configPath = join(repoPath, ".kunpeng", "geo", "config.json");
  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch (error) {
    const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
    if (code === "ENOENT") {
      throw new Error(`geo-monitor 配置缺失: ${configPath}`, { cause: error });
    }
    throw new Error(`geo-monitor 配置读取失败: ${configPath}`, { cause: error });
  }

  try {
    return parseGeoConfig(JSON.parse(text), configPath);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`geo-monitor 配置 JSON 解析失败: ${configPath}`, { cause: error });
    }
    throw error;
  }
}

function resolveNow(now: GeoMonitorRunWaveDeps["now"]): number {
  if (typeof now === "number") return now;
  return (now ?? Date.now)();
}

function maxQuestionCount(value: number | undefined): number {
  return Number.isFinite(value) && value !== undefined ? Math.max(0, Math.floor(value)) : 8;
}

function geoGapTitle(question: string): string {
  return `GEO 内容缺口：${question.slice(0, 60)}`;
}

function geoGapContext(answer: GeoAnswer): string {
  const citedDomains = answer.citedDomains.length > 0 ? answer.citedDomains.join(", ") : "无";
  return [
    `完整问题原文：${answer.question}`,
    `本波引用域名清单：${citedDomains}`,
    "给对应 guide 补 AI 直答段并更新 llms.txt 后，下波 geo-sweep 验证。",
  ].join("\n");
}

async function createGeoGapTasks(
  repoPath: string,
  loop: LoopDef,
  answers: GeoAnswer[],
  deps: Pick<GeoMonitorRunWaveDeps, "createTask" | "listTasks">,
): Promise<void> {
  const gaps = answers
    .filter((answer) => !answer.mentioned && answer.error === undefined)
    .slice(0, 5);
  if (gaps.length === 0) return;

  const listTasks: ListTasksFn = deps.listTasks ?? ((root) => listStoredTasks(root));
  const createTask: CreateTaskFn = deps.createTask ?? ((root, task) => createStoredTask(root, task));
  const existingTitles = new Set((await listTasks(repoPath)).map((task) => task.title));

  for (const answer of gaps) {
    const title = geoGapTitle(answer.question);
    if (existingTitles.has(title)) continue;

    await createTask(repoPath, {
      title,
      type: "geo-gap",
      projectId: loop.projectId,
      context: geoGapContext(answer),
      acceptanceCriteria: [`下一波 geo-sweep 该问题 mentioned=true：${answer.question}`],
    });
    existingTitles.add(title);
  }
}

export async function runGeoMonitorWave(
  loop: LoopDef,
  lever: string,
  _target: string | undefined,
  deps?: unknown,
): Promise<WaveResult> {
  const d = asDeps(deps);
  const at = resolveNow(d.now);
  const runner = makeDefaultAgentRunner(d);
  const repoPath = d.repoPath && d.repoPath.trim() !== "" ? d.repoPath : process.cwd();
  const config = readGeoConfig(repoPath);
  const questions = config.questions.slice(0, maxQuestionCount(d.maxQuestions));

  const answers: GeoAnswer[] = [];
  for (const question of questions) {
    try {
      const result = await runner.run({
        stage: "review",
        system: "",
        input: geoPrompt(question, config),
        tools: ["websearch"],
      });
      answers.push({
        ...parseGeoAnswer(question, result.text, config),
        ...(result.backend !== undefined ? { backend: result.backend } : {}),
        ...(result.modelUsed !== undefined ? { model: result.modelUsed } : {}),
        at,
      });
    } catch (error) {
      answers.push({
        question,
        mentioned: false,
        citedDomains: [],
        citedUrls: [],
        error: String(error).slice(0, 120),
        at,
      });
    }
  }

  const summary = summarizeGeoWave(answers);
  const instrument = {
    broken: summary.instrumentBroken,
    backend: answers.find((answer) => answer.backend !== undefined)?.backend,
    model: answers.find((answer) => answer.model !== undefined)?.model,
    at,
  };
  try {
    await createGeoGapTasks(repoPath, loop, answers, d);
  } catch {
    // 缺口任务落盘是跟进增强，失败不得影响本波结果。
  }

  const reportDir = join(repoPath, ".kunpeng", "geo");
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(
    join(reportDir, `report-${at}.json`),
    `${JSON.stringify({ answers, summary, instrument, ignoredSkills: d.skills ?? [] }, null, 2)}\n`,
    "utf8",
  );

  const metricBefore = loop.metric.current;
  if (summary.instrumentBroken) {
    const detail = `仪器故障：${summary.errors}/${summary.total} 题无法解析，本波不计入指标`;
    return {
      metricBefore,
      metricAfter: metricBefore,
      metricDelta: 0,
      verified: false,
      instrumentBroken: true,
      detail,
      gotchas: [detail],
      skillsActivated: [],
    };
  }
  return {
    metricBefore,
    metricAfter: summary.mentions,
    metricDelta: summary.mentions - metricBefore,
    verified: summary.total > 0 && summary.errors < summary.total,
    instrumentBroken: false,
    detail: `提及 ${summary.mentions}/${summary.total}（错 ${summary.errors}）`,
    gotchas: summary.gaps,
    skillsActivated: [],
  };
}
