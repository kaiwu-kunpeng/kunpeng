// token / chat 成本汇总的纯函数（从 state.ts 巨石析出：按模型/后端汇总 flow token、读 chat 会话算成本）。
import { isRecord } from "../util/is-record.js";
import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { CLAUDE_TIER, CODEX_TIER } from "../agent/model-routing.js";
import { kunpengStateDir } from "../project/registry.js";
import type { Stage } from "../agent/runner.js";
import type { CostSummary } from "../runtime/cost-metrics.js";
import type { ChatCostRollup, ProjectSnapshot, ProjectCostSummary } from "./state.js";

const CHAT_COST_ROLLUP = Symbol("chatCostRollup");
const SNAPSHOT_STATE_DIR = Symbol("snapshotStateDir");

type ChatCostCarrier = ProjectCostSummary & {
  [CHAT_COST_ROLLUP]?: ChatCostRollup;
};

type SnapshotStateDirCarrier = ProjectSnapshot & {
  [SNAPSHOT_STATE_DIR]?: string;
};

export function withSnapshotStateDir(snapshot: ProjectSnapshot, stateDir: string): ProjectSnapshot {
  Object.defineProperty(snapshot, SNAPSHOT_STATE_DIR, {
    value: stateDir,
    enumerable: false,
  });
  return snapshot;
}

export function buildCostByProject(snapshots: ProjectSnapshot[]): ProjectCostSummary[] {
  const costs = snapshots
    .map((snapshot) => {
      const cost = snapshot.state.costSummary;
      return {
        id: snapshot.id,
        name: snapshot.name,
        totalTokens: cost?.totalTokens ?? 0,
        llmStages: cost?.llmStages ?? 0,
        totalStages: cost?.totalStages ?? 0,
        deterministicStages: cost?.deterministicStages ?? 0,
        determinismRatio: cost?.determinismRatio ?? 0,
        savedLlmCalls: cost?.savedLlmCalls ?? 0,
        tokensByStage: cost?.tokensByStage ?? {},
        tokensByModel: cost?.tokensByModel ?? {},
        tokensByBackend: cost?.tokensByBackend ?? {},
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens || a.name.localeCompare(b.name));
  const stateDir = snapshots
    .map((snapshot) => (snapshot as SnapshotStateDirCarrier)[SNAPSHOT_STATE_DIR])
    .find((dir): dir is string => dir !== undefined);
  if (stateDir !== undefined && costs.length > 0) {
    const chatCost = readChatCostRollup(stateDir);
    if (chatCost.totalTokens > 0) {
      (costs[0] as ChatCostCarrier)[CHAT_COST_ROLLUP] = chatCost;
    }
  }
  return costs;
}

export function sumProjectCosts(
  list: ProjectCostSummary[],
): CostSummary & { tokensByStage: Record<string, number>; tokensByModel: Record<string, number>; tokensByBackend: Record<string, number> } {
  const tokensByStage: Record<string, number> = {};
  const tokensByModel: Record<string, number> = {};
  const tokensByBackend: Record<string, number> = {};
  let totalTokens = 0;
  let llmStages = 0;
  let totalStages = 0;
  let deterministicStages = 0;
  let savedLlmCalls = 0;
  let chatCost: ChatCostRollup | undefined;
  for (const project of list) {
    chatCost ??= (project as ChatCostCarrier)[CHAT_COST_ROLLUP];
    totalTokens += project.totalTokens;
    llmStages += project.llmStages;
    totalStages += project.totalStages;
    deterministicStages += project.deterministicStages;
    savedLlmCalls += project.savedLlmCalls;
    for (const [stage, tokens] of Object.entries(project.tokensByStage)) {
      tokensByStage[stage] = (tokensByStage[stage] ?? 0) + tokens;
    }
    for (const [model, tokens] of Object.entries(project.tokensByModel ?? {})) {
      tokensByModel[model] = (tokensByModel[model] ?? 0) + tokens;
    }
    for (const [backend, tokens] of Object.entries(project.tokensByBackend ?? {})) {
      tokensByBackend[backend] = (tokensByBackend[backend] ?? 0) + tokens;
    }
  }
  if (chatCost !== undefined && chatCost.totalTokens > 0) {
    totalTokens += chatCost.totalTokens;
    tokensByBackend.chat = (tokensByBackend.chat ?? 0) + chatCost.totalTokens;
    for (const [model, tokens] of Object.entries(chatCost.tokensByModel)) {
      tokensByModel[model] = (tokensByModel[model] ?? 0) + tokens;
    }
  }
  return {
    totalStages,
    llmStages,
    deterministicStages,
    totalTokens,
    determinismRatio: totalStages > 0 ? deterministicStages / totalStages : 0,
    savedLlmCalls,
    tokensByStage,
    tokensByModel,
    tokensByBackend,
  };
}

export function aggregateTokensByModel(
  flows: { backend?: string; stageBackends?: Record<string, string>; stageModels?: Record<string, string>; stageTokens?: Record<string, number> }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const flow of flows) {
    for (const [stage, tokens] of Object.entries(flow.stageTokens ?? {})) {
      const model = flow.stageModels?.[stage];
      if (model) {
        const n = Number(tokens);
        out[model] = (out[model] ?? 0) + (Number.isFinite(n) && n > 0 ? n : 0);
        continue;
      }
      const backend = flow.stageBackends?.[stage] ?? flow.backend;
      const table = backend === "claude" ? CLAUDE_TIER : CODEX_TIER;
      const tier = table[stage as Stage];
      const label = tier?.model ?? tier?.effort;
      if (!label) continue;
      const n = Number(tokens);
      out[label] = (out[label] ?? 0) + (Number.isFinite(n) && n > 0 ? n : 0);
    }
  }
  return out;
}

export function aggregateChatTokensByModel(
  conversations: { turns?: { usage?: { input?: number; output?: number; model?: string } }[] }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const conversation of conversations) {
    for (const turn of conversation.turns ?? []) {
      const usage = turn.usage;
      const tokens = (usage?.input ?? 0) + (usage?.output ?? 0);
      if (!Number.isFinite(tokens) || tokens <= 0) continue;
      const model = usage?.model?.trim() || "chat-unknown";
      out[model] = (out[model] ?? 0) + tokens;
    }
  }
  return out;
}

function chatTokenTotal(tokensByModel: Record<string, number>): number {
  return Object.values(tokensByModel).reduce((sum, tokens) => sum + tokens, 0);
}

function readChatConversationsSync(dir: string): { turns?: { usage?: { input?: number; output?: number; model?: string } }[] }[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const conversations: { turns?: { usage?: { input?: number; output?: number; model?: string } }[] }[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      conversations.push(...readChatConversationsSync(path));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "index.json") continue;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      if (isRecord(parsed) && Array.isArray(parsed.turns)) {
        conversations.push(parsed as { turns?: { usage?: { input?: number; output?: number; model?: string } }[] });
      }
    } catch {
      // 单个坏会话文件不能拖垮总览成本统计。
    }
  }
  return conversations;
}

function readChatCostRollup(stateDir: string): ChatCostRollup {
  const tokensByModel = aggregateChatTokensByModel(readChatConversationsSync(join(stateDir || kunpengStateDir(), "chat")));
  return { totalTokens: chatTokenTotal(tokensByModel), tokensByModel };
}

/** 按后端(claude/codex/…)汇总 token——用每阶段真实后端,混合流也对。 */
export function aggregateTokensByBackend(
  flows: { backend?: string; stageBackends?: Record<string, string>; stageTokens?: Record<string, number> }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const flow of flows) {
    for (const [stage, tokens] of Object.entries(flow.stageTokens ?? {})) {
      const backend = flow.stageBackends?.[stage] ?? flow.backend ?? "codex";
      const n = Number(tokens);
      out[backend] = (out[backend] ?? 0) + (Number.isFinite(n) && n > 0 ? n : 0);
    }
  }
  return out;
}
