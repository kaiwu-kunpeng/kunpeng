import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { CliRunner } from "../../../agent/cli-runner.js";
import type { LoopDef } from "../../types.js";
import type { WaveResult } from "../../recipe.js";
import { parseAop, type AopPlan, type AopStep } from "../../aop.js";
import { resolveStepTimeoutMs } from "../../aop-timeout.js";
import { listPlaybooks } from "../../playbook.js";
import { listSkills, recordSkillActivation, skillsRoot } from "../../../skills/registry.js";
import { matchesTriggers } from "../../../skills/skill-md.js";

const DEFAULT_ASSERT_TIMEOUT_MS = 120_000;
const FULL_SKILL_INJECTION_LIMIT = 2;
const SKILL_PREAMBLE_HEADER = [
  "## 技能渐进披露",
  "优先使用下列已注入技能；未注入全文的技能仅在需要时用 Read 按需读取全文。",
].join("\n");

export interface AgentStepRunner {
  runStep(prompt: string, timeoutMs?: number): Promise<void>;
}

interface LoadedPlaybook {
  body: string;
  skills?: string[];
  metricCmd?: string;
}

export interface AgentPlaybookDeps {
  repoPath?: string;
  skills?: string[];
  env?: NodeJS.ProcessEnv;
  runner?: AgentStepRunner;
  loadPlaybook?: (repoRoot: string, id: string) => Promise<LoadedPlaybook | undefined>;
  loadSkill?: (id: string) => Promise<string | undefined>;
  skillsRootOverride?: string;
  execAssert?: (cmd: string, cwd: string) => Promise<number>;
  execMetric?: (cmd: string, cwd: string) => Promise<string>;
}

function requireValue(value: string | undefined, name: string): string {
  if (!value || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function prioritizeDeclaredSkills(
  declaredSkillIds: string[],
  registeredSkills: ReturnType<typeof listSkills>,
  goal: string,
): string[] {
  const entriesById = new Map(registeredSkills.map((entry) => [entry.id, entry]));
  return declaredSkillIds
    .map((id, index) => {
      const entry = entriesById.get(id);
      let priority = 0;
      if (entry && Object.prototype.hasOwnProperty.call(entry, "triggers")) {
        priority = matchesTriggers({
          name: entry.name,
          description: entry.description,
          triggers: entry.triggers,
        }, goal) ? -1 : 1;
      }
      return { id, index, priority };
    })
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map(({ id }) => id);
}

function waveResult(
  loop: LoopDef,
  verified: boolean,
  passed: number,
  total: number,
  gotchas?: string[],
  skillsActivated?: string[],
): WaveResult {
  return {
    metricBefore: loop.metric.current,
    metricAfter: loop.metric.current,
    metricDelta: 0,
    verified,
    detail: `passed ${passed}/${total}`,
    ...(gotchas && gotchas.length > 0 ? { gotchas } : {}),
    ...(skillsActivated !== undefined ? { skillsActivated } : {}),
  };
}

async function defaultLoadPlaybook(repoRoot: string, id: string): Promise<LoadedPlaybook | undefined> {
  const playbooks = await listPlaybooks(repoRoot);
  const found = playbooks.find((playbook) => playbook.id === id);
  return found
    ? {
        body: found.body,
        ...(found.skills ? { skills: found.skills } : {}),
        ...(found.metricCmd ? { metricCmd: found.metricCmd } : {}),
      }
    : undefined;
}

async function defaultLoadSkill(
  root: string,
  id: string,
): Promise<{ status: "loaded"; body: string } | { status: "disabled" } | { status: "missing" }> {
  const entry = listSkills(root).find((skill) => skill.id === id);
  if (!entry) return { status: "missing" };
  if (entry.enabled === false) return { status: "disabled" };
  try {
    return { status: "loaded", body: await readFile(join(entry.dir, "SKILL.md"), "utf8") };
  } catch {
    return { status: "missing" };
  }
}

function defaultExecAssert(cmd: string, cwd: string, env?: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    let done = false;
    const child = spawn("sh", ["-c", cmd], {
      cwd,
      env: { ...process.env, ...env },
      stdio: "ignore",
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      if (!done) {
        done = true;
        resolve(124);
      }
    }, DEFAULT_ASSERT_TIMEOUT_MS);
    const settle = (code: number): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(code);
    };
    child.on("error", () => settle(1));
    child.on("close", (code) => settle(code ?? 1));
  });
}

function defaultExecMetric(cmd: string, cwd: string, env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    let done = false;
    let stdout = "";
    const child = spawn("sh", ["-c", cmd], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "ignore"],
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      if (!done) {
        done = true;
        reject(new Error(`metricCmd timed out after ${DEFAULT_ASSERT_TIMEOUT_MS}ms`));
      }
    }, DEFAULT_ASSERT_TIMEOUT_MS);
    const settle = (error?: Error): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
      } else {
        resolve(stdout);
      }
    };
    child.on("error", (error) => settle(error));
    child.on("close", (code) => {
      settle(code === 0 ? undefined : new Error(`metricCmd exited with code ${code ?? 1}`));
    });
  });
}

export function parseMetricOutput(stdout: string): number | undefined {
  try {
    let parsed: number | undefined;
    for (const token of stdout.trim().split(/\s+/)) {
      if (token.length === 0) continue;
      const value = Number(token);
      if (Number.isFinite(value)) parsed = value;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function stepRunnerOptions(timeoutMs?: number): { backend: "claude"; timeoutMs?: number; idleTimeoutMs?: number } {
  return timeoutMs === undefined
    ? { backend: "claude" }
    : { backend: "claude", timeoutMs, idleTimeoutMs: timeoutMs };
}

function defaultRunner(repoRoot: string): AgentStepRunner {
  return {
    async runStep(prompt: string, timeoutMs?: number): Promise<void> {
      const runner = new CliRunner(stepRunnerOptions(timeoutMs));
      await runner.run({
        stage: "implement",
        system: "按 agent-playbook 的 aop 步骤执行当前单步，只做该步骤要求的改动或检查。",
        input: prompt,
        tools: ["write", "edit", "bash"],
        cwd: repoRoot,
      });
    },
  };
}

export function directionPreamble(loop: LoopDef, target: string | undefined): string {
  const note = loop.nextLever?.note?.trim();
  const t = target?.trim();
  if (!note && !t) return "";

  const lines = ["【本波方向 · 来自 loop.nextLever，优先于步骤内的自选】"];
  if (t) lines.push(`目标对象: ${t}`);
  if (note) lines.push(`方向: ${note}`);
  return lines.join("\n");
}

function stepPrompt(
  plan: AopPlan,
  step: AopStep,
  index: number,
  total: number,
  skillPreamble: string,
  direction: string,
): string {
  return [skillPreamble, direction, `目标: ${plan.goal}`, `步骤: ${index + 1}/${total}`, `步骤ID: ${step.id}`, step.prompt]
    .filter((part) => part.length > 0)
    .join("\n");
}

export async function runAgentPlaybookWave(
  loop: LoopDef,
  lever: string,
  target: string | undefined,
  deps: AgentPlaybookDeps = {},
): Promise<WaveResult> {
  const repoRoot = requireValue(deps.repoPath, "repoPath");
  const loadPlaybook = deps.loadPlaybook ?? defaultLoadPlaybook;

  let loaded: LoadedPlaybook | undefined;
  try {
    loaded = await loadPlaybook(repoRoot, lever);
  } catch (error) {
    return waveResult(loop, false, 0, 0, [`playbook 读取失败: ${error instanceof Error ? error.message : String(error)}`]);
  }
  if (!loaded) return waveResult(loop, false, 0, 0, ["playbook 不存在"]);

  const plan = parseAop(loaded.body);
  if (!plan) return waveResult(loop, false, 0, 0, ["无 aop 步骤树"]);

  const skillRoot = deps.skillsRootOverride ?? skillsRoot();
  const customLoadSkill = deps.loadSkill;
  const preambleParts: string[] = [];
  const skillSummaryLines: string[] = [];
  const activatedSkillIds: string[] = [];
  const skillGotchas: string[] = [];
  const declaredSkillIds = [...new Set([...(loaded.skills ?? []), ...(deps.skills ?? [])])];
  let registeredSkills: ReturnType<typeof listSkills> = [];
  if (declaredSkillIds.length > 0) {
    try {
      registeredSkills = listSkills(skillRoot);
    } catch {
      registeredSkills = [];
    }
  }
  const prioritizedSkillIds = prioritizeDeclaredSkills(declaredSkillIds, registeredSkills, plan.goal);

  for (const [skillIndex, skillId] of prioritizedSkillIds.entries()) {
    if (skillIndex >= FULL_SKILL_INJECTION_LIMIT) {
      const entry = registeredSkills.find((skill) => skill.id === skillId);
      if (!entry) {
        return waveResult(loop, false, 0, plan.steps.length, [
          ...skillGotchas,
          `技能不存在或不可读: ${skillId}（playbook 声明的技能必须已注册）`,
        ]);
      }
      if (entry.enabled === false) {
        skillGotchas.push(`技能 ${skillId} 已停用,未注入`);
        continue;
      }
      skillSummaryLines.push(
        `- ${singleLine(entry.name)}: ${singleLine(entry.description)}`
        + `(需要时用 Read 读取完整内容: ${singleLine(join(entry.dir, "SKILL.md"))})`,
      );
      activatedSkillIds.push(skillId);
      continue;
    }

    let skillBody: string | undefined;
    if (customLoadSkill) {
      try {
        skillBody = await customLoadSkill(skillId);
      } catch {
        skillBody = undefined;
      }
    } else {
      try {
        const result = await defaultLoadSkill(skillRoot, skillId);
        if (result.status === "disabled") {
          skillGotchas.push(`技能 ${skillId} 已停用,未注入`);
          continue;
        }
        skillBody = result.status === "loaded" ? result.body : undefined;
      } catch {
        skillBody = undefined;
      }
    }
    if (skillBody === undefined) {
      return waveResult(loop, false, 0, plan.steps.length, [
        ...skillGotchas,
        `技能不存在或不可读: ${skillId}（playbook 声明的技能必须已注册）`,
      ]);
    }
    preambleParts.push(`【技能·${skillId}】\n${skillBody}`);
    activatedSkillIds.push(skillId);
  }
  const skillPreambleParts = [
    ...preambleParts,
    ...(skillSummaryLines.length > 0 ? [skillSummaryLines.join("\n")] : []),
  ];
  const skillPreamble = skillPreambleParts.length > 0
    ? [SKILL_PREAMBLE_HEADER, ...skillPreambleParts].join("\n\n")
    : "";
  if (activatedSkillIds.length > 0) {
    try {
      recordSkillActivation(skillRoot, activatedSkillIds);
    } catch {
      // 用量埋点是 best-effort，不得改变 wave 的既有执行结果。
    }
  }

  const runner = deps.runner ?? defaultRunner(repoRoot);
  const execAssert = deps.execAssert ?? ((cmd, cwd) => defaultExecAssert(cmd, cwd, deps.env));
  const direction = directionPreamble(loop, target);
  let passed = 0;

  for (const [index, step] of plan.steps.entries()) {
    if (step.external === true) {
      return waveResult(loop, false, passed, plan.steps.length, [
        ...skillGotchas,
        `对外步骤 ${step.id} 需动作级门，前半执行器停止`,
      ], activatedSkillIds);
    }

    try {
      await runner.runStep(
        stepPrompt(plan, step, index, plan.steps.length, skillPreamble, direction),
        resolveStepTimeoutMs(step.timeoutMs, process.env),
      );
    } catch (error) {
      return waveResult(loop, false, passed, plan.steps.length, [
        ...skillGotchas,
        `${step.id} 执行失败: ${error instanceof Error ? error.message : String(error)}`,
      ], activatedSkillIds);
    }

    if (step.assert) {
      let code: number;
      try {
        code = await execAssert(step.assert, repoRoot);
      } catch (error) {
        return waveResult(loop, false, passed, plan.steps.length, [
          ...skillGotchas,
          `${step.id} 断言异常: ${error instanceof Error ? error.message : String(error)}`,
        ], activatedSkillIds);
      }
      if (code !== 0) {
        return waveResult(loop, false, passed, plan.steps.length, [
          ...skillGotchas,
          `${step.id} 断言失败 exit ${code}`,
        ], activatedSkillIds);
      }
    }

    passed += 1;
  }

  const result = waveResult(loop, true, passed, plan.steps.length, skillGotchas, activatedSkillIds);
  if (!loaded.metricCmd) return result;

  const execMetric = deps.execMetric ?? ((cmd, cwd) => defaultExecMetric(cmd, cwd, deps.env));
  try {
    const stdout = await execMetric(loaded.metricCmd, repoRoot);
    const metricAfter = parseMetricOutput(stdout);
    if (metricAfter === undefined) {
      return waveResult(loop, true, passed, plan.steps.length, [
        ...skillGotchas,
        "metricCmd 输出中没有可解析的有限数字，指标增量退回 0",
      ], activatedSkillIds);
    }
    return {
      ...result,
      metricAfter,
      metricDelta: metricAfter - loop.metric.current,
    };
  } catch (error) {
    return waveResult(loop, true, passed, plan.steps.length, [
      ...skillGotchas,
      `metricCmd 计量失败，指标增量退回 0: ${error instanceof Error ? error.message : String(error)}`,
    ], activatedSkillIds);
  }
}
