import { join } from "node:path";
import { makeFlowId } from "../util/flow-id.js";
import { DevCycle } from "../loop/dev-cycle.js";
import { createDevCycleRunLoop, type RunDevCycle } from "../loop/devcycle-loop-adapter.js";
import { WorkspaceDriver } from "../loop/workspace-driver.js";
import { mergeAndClearGate } from "../runtime/merge-gate.js";
import { createWorkspaceTranscript } from "../runtime/workspace-transcript.js";
import { createContext } from "../sdk/context.js";
import { CliRunner, type Backend } from "../agent/cli-runner.js";
import { FlowRepoStore } from "./flow-repo-store.js";
import { fileSwitchboardSender } from "../switchboard/default-sender.js";
import type { SwitchboardSender } from "../switchboard/store.js";

const GPT6_MODELS = new Set(["gpt-6-astra", "gpt-6-sol", "gpt-6-luna"]);

export function evictOldest<K, V>(
  map: Map<K, V>,
  max: number,
  onEvict?: (key: K, value: V) => void,
): K[] {
  const evicted: K[] = [];
  while (map.size > max) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    const key = oldest.value;
    const value = map.get(key) as V;
    map.delete(key);
    evicted.push(key);
    if (onEvict) onEvict(key, value);
  }
  return evicted;
}

export interface WorkspaceDriverDeps {
  runDevCycle: RunDevCycle;
  onMerge: (flowId: string) => Promise<void>;
  onReject?: (flowId: string) => Promise<void>;
  transcriptDir: string;
}

export function buildWorkspaceDriver(deps: WorkspaceDriverDeps): WorkspaceDriver {
  const runLoop = createDevCycleRunLoop({
    runDevCycle: deps.runDevCycle,
    onMerge: deps.onMerge,
    onReject: deps.onReject ?? (async () => {}),
  });
  return new WorkspaceDriver({
    runLoop,
    transcript: createWorkspaceTranscript(deps.transcriptDir),
  });
}

export interface TaskModelResolution {
  backend?: Backend;
  modelOverride?: string;
}

export const PANEL_SCOPE_ALLOW = ["**"];

export function panelDevCycleDeps<T extends object, E>(
  base: T,
  flowId: string,
  onEvent: E,
  modelOverride?: string,
): T & { flowId: string; onEvent: E; scopeAllow: string[]; switchboard: SwitchboardSender; modelOverride?: string } {
  return {
    ...base,
    flowId,
    onEvent,
    scopeAllow: PANEL_SCOPE_ALLOW,
    switchboard: fileSwitchboardSender(),
    ...(modelOverride ? { modelOverride } : {}),
  };
}

export function resolveTaskModel(model?: string): TaskModelResolution {
  const selected = model?.trim();
  if (!selected) return {};
  if (selected === "codex") return { backend: "codex", modelOverride: "gpt-5.5" };
  if (GPT6_MODELS.has(selected)) return { backend: "codex", modelOverride: selected };
  if (selected.startsWith("gpt-5")) return { backend: "codex", modelOverride: selected };
  return { modelOverride: selected };
}

export function productionWorkspaceDeps(
  resolveRepoRoot: (workspaceId: string) => Promise<string>,
  kunpengHome: string,
): WorkspaceDriverDeps {
  const flowRepo = new FlowRepoStore(join(kunpengHome, "flow-repos.json"));
  const runDevCycle: RunDevCycle = async (workspaceId, message, onEvent, model, signal) => {
    const repoRoot = await resolveRepoRoot(workspaceId);
    const flowId = makeFlowId(message, Date.now());
    flowRepo.set(flowId, repoRoot);
    const ctx = await createContext(repoRoot, kunpengHome);
    const taskModel = resolveTaskModel(model);
    const runner = taskModel.backend
      ? new CliRunner({
          backend: taskModel.backend,
          accounts: ctx.accounts,
          quota: ctx.quota,
          quotaPath: ctx.quotaPath,
        })
      : ctx.runner;
    const dc = new DevCycle(panelDevCycleDeps(
      { ...ctx, runner },
      flowId,
      onEvent,
      taskModel.modelOverride,
    ));
    await dc.run(message, signal ? { signal } : {});
  };

  return {
    runDevCycle,
    onMerge: async (flowId) => {
      const repoRoot = flowRepo.get(flowId);
      if (!repoRoot) {
        throw new Error(`无法定位 flow ${flowId} 的仓库(映射已丢失),合并未执行——请重跑该流`);
      }
      await mergeAndClearGate(repoRoot, flowId, "main", { allowSensitive: true, clearedBy: { by: "human", via: "workbench" } });
    },
    transcriptDir: join(process.cwd(), ".kunpeng", "workspace-transcripts"),
  };
}
