import { join } from "node:path";

import { appendAction, readActions } from "./action-ledger.js";
import { deriveLearning, LoopLearningStore, type Learning } from "./learnings.js";
import { gateLoopWaveByBudget, opsSpentTokensThisMonth } from "./ops-budget.js";
import { guardWave, type OpsGuardVerdict } from "./ops-guard.js";
import { getRecipe, recipeRegistry, resolveWaveLevel, type LoopRecipe, type WaveResult } from "./recipe.js";
import { consumeApprovedOpsGate, createOpsGate } from "./ops-gate.js";
import { isHardGateLevel, syntheticEvidenceAllowed } from "../policy/action-levels.js";
import { LoopStore } from "./store.js";
import type { LoopDef, Wave } from "./types.js";
import { GoalStore, goalsDir } from "../goals/store.js";
import { FlowTracker, type HumanGate } from "../runtime/flowstate.js";
import { kunpengStateDir, readProjectSelf, readRegistry } from "../project/registry.js";
import { resolveProjectStateDir } from "../project/state-resolve.js";
import type { SwitchboardSender } from "../switchboard/store.js";
import { defaultPresenceBeater, startPresenceHeartbeat, type PresenceBeater } from "../switchboard/presence-heartbeat.js";
import "./geo-monitor.js";
import "./seo-internal-links.js";
import "./agent-playbook.js";
import "./wechat-capture.js";
import "./site-capture.js";

export interface LoopWaveStore {
  read(id: string): Promise<LoopDef | null>;
  appendWave(id: string, wave: Omit<Wave, "seq">): Promise<Wave>;
}

export interface LoopWaveTracker {
  start(flowId: string, requirement: string): Promise<void>;
  finish(flowId: string, status: "verified" | "rolled-back", humanGate?: HumanGate, reason?: string): Promise<void>;
}

export interface RunLoopWaveDeps {
  presence?: PresenceBeater;
  repoRoot?: string;
  stateDir?: string;
  store?: LoopWaveStore;
  tracker?: LoopWaveTracker;
  goalStore?: { setCurrent(id: string, current: number, by?: string): Promise<unknown> };
  getRecipe?: (id: string) => LoopRecipe;
  resolveRepoPath?: (projectId: string) => Promise<string> | string;
  learningStore?: {
    append(id: string, learning: Learning): Promise<void>;
    recent?(id: string, n?: number): Promise<Learning[]>;
  };
  env?: Record<string, string | undefined>;
  recipeDeps?: unknown;
  now?: () => number;
  guard?: typeof guardWave;
  guardDisabled?: boolean;
  /** Optional lifecycle-message sink. Notification failures never change the wave result. */
  switchboard?: SwitchboardSender;
}

export type RunLoopWaveResult =
  | { gated: true; flowId: string; loop: LoopDef; humanGate: HumanGate }
  | { gated: false; loop: LoopDef; wave: Wave; flowId: string; result: WaveResult };

function requireRepoRoot(repoRoot: string | undefined): string {
  return repoRoot ?? process.cwd();
}

function loopStore(repoRoot: string): LoopStore {
  return new LoopStore(join(repoRoot, ".kunpeng", "loops"));
}

function loopStateDir(repoRoot: string): string {
  try {
    return resolveProjectStateDir(repoRoot);
  } catch {
    return join(repoRoot, ".kunpeng");
  }
}

async function defaultResolveRepoPath(projectId: string, repoRoot: string, stateDir?: string): Promise<string> {
  const projects = await readRegistry(stateDir ?? kunpengStateDir());
  const found = projects.find((project) => project.id === projectId);
  if (found) return found.repoPath;

  const self = await readProjectSelf(repoRoot);
  if (self?.id === projectId) return repoRoot;

  throw new Error(`project repoPath not found for ${projectId}`);
}

function mergeRecipeDeps(recipeDeps: unknown, repoPath: string, recentLearnings: Learning[], skills: string[], repoRoot: string, stateDir: string): unknown {
  if (typeof recipeDeps === "object" && recipeDeps !== null && !Array.isArray(recipeDeps)) {
    return { ...recipeDeps, repoPath, recentLearnings, skills, repoRoot, stateDir };
  }
  return { repoPath, recentLearnings, skills, repoRoot, stateDir };
}

function guardGateDescription(verdict: OpsGuardVerdict): string {
  const kind = verdict.kind ?? "unknown";
  const reason = verdict.reason ?? "护栏未提供具体原因";
  if (verdict.kind === "sensitive") return `[${kind}] 敏感波需人工批准；${reason}`;
  if (verdict.kind === "halt") return `[${kind}] 连败熔断,请调整目标/配方或手动恢复；${reason}`;
  if (verdict.kind === "budget") return `[${kind}] 波级 token 预算拦截；${reason}`;
  return `[${kind}] 波前护栏拦截；${reason}`;
}

async function notifyIdle(
  switchboard: SwitchboardSender | undefined,
  input: { loopId: string; flowId: string; verdict: "verified" | "rolled-back"; summary: string },
): Promise<void> {
  if (!switchboard) return;
  try {
    await switchboard.send({
      from: "loop-driver",
      to: "all",
      topic: input.flowId,
      body: `loop ${input.loopId} ${input.verdict}: ${input.summary}`,
      kind: "idle_notification",
      origin: { kind: "agent" },
      payload: {
        loopId: input.loopId,
        flowId: input.flowId,
        verdict: input.verdict,
        summary: input.summary,
      },
    });
  } catch {
    // Lifecycle observability is best-effort and must not change the completed wave result.
  }
}

export async function runLoopWave(loopId: string, deps: RunLoopWaveDeps = {}): Promise<RunLoopWaveResult> {
  const presenceHeartbeat = startPresenceHeartbeat({
    presence: deps.presence ?? defaultPresenceBeater(),
    instance: `loop:${loopId}`,
    meta: { task: "ops loop wave", ...(deps.repoRoot !== undefined ? { worktree: deps.repoRoot } : {}) },
    ...(deps.now !== undefined ? { now: deps.now } : {}),
  });
  try {
    return await runLoopWaveBody(loopId, deps);
  } finally {
    await presenceHeartbeat.stop();
  }
}

async function runLoopWaveBody(loopId: string, deps: RunLoopWaveDeps): Promise<RunLoopWaveResult> {
  const repoRoot = requireRepoRoot(deps.repoRoot);
  const projectStateDir = loopStateDir(repoRoot);
  const store = deps.store ?? loopStore(repoRoot);
  const tracker = deps.tracker ?? new FlowTracker(projectStateDir);
  const loop = await store.read(loopId);
  if (!loop) throw new Error(`loop not found: ${loopId}`);
  if (!loop.nextLever) throw new Error(`loop ${loopId} has no nextLever`);
  const nextLever = loop.nextLever;
  const registeredRecipe = recipeRegistry[loop.recipe];
  const allowsUnlistedLever = registeredRecipe?.allowsUnlistedLever?.(nextLever.lever) === true;
  if (!loop.levers.some((l) => l.id === nextLever.lever) && !allowsUnlistedLever) {
    throw new Error(`unsupported loop nextLever: ${nextLever.lever}`);
  }

  const subject = nextLever.target ?? nextLever.lever;
  const now = (deps.now ?? Date.now)();
  const budgetGate = gateLoopWaveByBudget(projectStateDir, deps.env ?? process.env, now);
  if (budgetGate.halt) {
    const spentTokens = opsSpentTokensThisMonth(projectStateDir, now);
    throw new Error(`ops 预算超限：已花 token ${spentTokens}`);
  }

  if (loop.autonomous !== true) {
    const flowId = `loop-${loop.id}-gate-${now}`;
    const humanGate = {
      gate: "运营 loop 对外推送",
      what: `${loop.name} / ${loop.nextLever.lever} / ${subject}`,
    };
    await tracker.start(flowId, subject);
    await tracker.finish(
      flowId,
      "rolled-back",
      humanGate,
      `[loop-gate] 非自治 loop 需人工批准对外推送：${humanGate.what}`,
    );
    await notifyIdle(deps.switchboard, {
      loopId: loop.id,
      flowId,
      verdict: "rolled-back",
      summary: humanGate.what,
    });
    return { gated: true, flowId, loop, humanGate };
  }

  if (deps.guardDisabled !== true) {
    const actions = await readActions(projectStateDir, { loopId: loop.id });
    const verdict = (deps.guard ?? guardWave)({
      actions,
      loopId: loop.id,
      waveText: `${nextLever.lever} ${nextLever.target ?? ""} ${nextLever.note ?? ""} ${subject}`,
      observational: loop.metric.observational === true,
      tokensSpent30d: 0,
    });
    if (!verdict.allow) {
      const flowId = `loop-${loop.id}-guard-${now}`;
      const humanGate = {
        gate: "运营 loop 波前护栏",
        what: guardGateDescription(verdict),
      };
      await tracker.start(flowId, subject);
      await tracker.finish(flowId, "rolled-back", humanGate, `[loop-guard] ${humanGate.what}`);
      await notifyIdle(deps.switchboard, {
        loopId: loop.id,
        flowId,
        verdict: "rolled-back",
        summary: humanGate.what,
      });
      return { gated: true, flowId, loop, humanGate };
    }
  }

  const recipe = (deps.getRecipe ?? getRecipe)(loop.recipe);
  if (!recipe.runWave) {
    throw new Error(`loop recipe does not support runWave: ${loop.recipe}`);
  }
  // L3/L4 每波必须消费一张有效批条；未获批准时开门并停在执行之前。
  const waveLevel = resolveWaveLevel(loop, nextLever.lever, recipe);
  if (waveLevel !== undefined && isHardGateLevel(waveLevel)) {
    const ticket = await consumeApprovedOpsGate(repoRoot, { loopId: loop.id, level: waveLevel }, now);
    if (!ticket) {
      const gate = await createOpsGate(repoRoot, {
        projectId: loop.projectId,
        playbookId: `loop:${loop.id}:${nextLever.lever}`,
        loopId: loop.id,
        reason: `动作等级 ${waveLevel}：${loop.name} / ${nextLever.lever} / ${subject}`,
        level: waveLevel,
      }, now);
      const flowId = `loop-${loop.id}-level-${now}`;
      const humanGate = {
        gate: "运营 loop 动作等级门",
        what: `${loop.name} / ${nextLever.lever} / ${subject} · ${waveLevel} · ${gate.id}`,
      };
      await tracker.start(flowId, subject);
      await tracker.finish(flowId, "rolled-back", humanGate, `[loop-level-gate] ${humanGate.what}`);
      await notifyIdle(deps.switchboard, { loopId: loop.id, flowId, verdict: "rolled-back", summary: humanGate.what });
      return { gated: true, flowId, loop, humanGate };
    }
  }
  const repoPath = await (deps.resolveRepoPath
    ? deps.resolveRepoPath(loop.projectId)
    : defaultResolveRepoPath(loop.projectId, repoRoot, deps.stateDir));
  const ls = deps.learningStore ?? new LoopLearningStore(join(repoRoot, ".kunpeng", "loops"));
  const recentLearnings = ls.recent ? await ls.recent(loop.id, 5) : [];
  const result = await recipe.runWave(
    loop,
    nextLever.lever,
    nextLever.target,
    mergeRecipeDeps(deps.recipeDeps, repoPath, recentLearnings, nextLever.skills ?? [], repoRoot, projectStateDir),
  );

  const evidenceKind = result.evidenceKind ?? recipe.defaultEvidenceKind;
  const syntheticEvidenceRejected = evidenceKind === "llm-self-report"
    && waveLevel !== undefined && !syntheticEvidenceAllowed(waveLevel);
  const detail = syntheticEvidenceRejected
    ? `[synthetic-evidence] 合成证据（llm-self-report）不能支撑 ${waveLevel} 动作的验证${result.detail ? `；${result.detail}` : ""}`
    : result.detail;
  const wave = await store.appendWave(loop.id, {
    at: now,
    lever: nextLever.lever,
    subject,
    metricDelta: result.metricDelta,
    metricAfter: result.metricAfter,
    verified: syntheticEvidenceRejected ? false : result.verified,
    ...(evidenceKind ? { evidenceKind } : {}),
    ...(result.level ?? waveLevel ? { level: result.level ?? waveLevel } : {}),
    ...(result.outboxId ? { outboxId: result.outboxId } : {}),
    ...(result.commit ? { commit: result.commit } : {}),
    ...(result.deploy ? { deploy: result.deploy } : {}),
    ...(detail ? { detail } : {}),
    ...(result.gotchas?.length ? { gotchas: result.gotchas } : {}),
    ...(result.instrumentBroken === true ? { instrumentBroken: true } : {}),
  });
  try {
    await appendAction(projectStateDir, {
      at: wave.at,
      loopId: loop.id,
      projectId: loop.projectId,
      recipe: loop.recipe,
      lever: wave.lever,
      subject: wave.subject,
      metricKey: loop.metric.key,
      metricAfter: wave.metricAfter,
      metricDelta: wave.metricDelta,
      verified: wave.verified,
      ...(wave.evidenceKind ? { evidenceKind: wave.evidenceKind } : {}),
      ...(wave.level ? { level: wave.level } : {}),
      ...(loop.goalId ? { goalId: loop.goalId } : {}),
      ...(wave.outboxId ? { outboxId: wave.outboxId } : {}),
      ...(result.evidence ? { evidence: result.evidence } : {}),
      ...(wave.commit ? { commit: wave.commit } : {}),
      ...(wave.deploy ? { deploy: wave.deploy } : {}),
      ...(wave.instrumentBroken === true ? { instrumentBroken: true } : {}),
      ...(Array.isArray(result.skillsActivated) ? { skills: result.skillsActivated } : {}),
    });
  } catch {
    // The ledger is observability data; a write failure must not fail the completed wave.
  }
  if (loop.goalId && typeof result.goalMetricCurrent === "number") {
    try {
      const goalStore = deps.goalStore ?? new GoalStore(goalsDir(join(repoRoot, ".kunpeng")));
      const goal = await goalStore.setCurrent(loop.goalId, result.goalMetricCurrent, `loop:${loop.id}`);
      if (goal === null) console.warn(`[loop] goal writeback: goal not found: ${loop.goalId}`);
    } catch (error) {
      console.warn(`[loop] goal writeback failed for ${loop.goalId}: ${String(error)}`);
    }
  }
  const learning = deriveLearning(wave);
  if (learning) {
    await ls.append(loop.id, learning);
  }
  const flowId = `loop-${loop.id}-w${wave.seq}`;
  await tracker.start(flowId, subject);
  const verdict = wave.verified ? "verified" : "rolled-back";
  if (wave.verified === true) {
    await tracker.finish(flowId, "verified");
  } else {
    await tracker.finish(
      flowId,
      "rolled-back",
      undefined,
      `[loop-wave-unverified] ${wave.detail ?? subject}`,
    );
  }
  await notifyIdle(deps.switchboard, {
    loopId: loop.id,
    flowId,
    verdict,
    summary: wave.detail ?? subject,
  });
  return { gated: false, loop, wave, flowId, result };
}
