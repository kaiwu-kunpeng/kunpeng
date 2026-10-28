import { readFlowOptions } from "../runtime/flow-options.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ArtifactStore } from "../artifacts/store.js";
import { CliRunner } from "../agent/cli-runner.js";
import { loadBackendConfig } from "../agent/backend-config.js";
import type { Backend } from "../agent/backend-routing.js";
import type { Stage } from "../agent/runner.js";
import { loadAccounts, type Account } from "../agent/account-pool.js";
import { loadQuota, type QuotaTracker } from "../agent/quota-tracker.js";
import { Workspace } from "../git/workspace.js";
import { FlowTracker } from "../runtime/flowstate.js";
import { reconcileDeadFlows, reconcileGhostMergeGates } from "../runtime/reconcile.js";
import { detectChecks, type ProjectChecks } from "../project/detect.js";
import { resolveProjectStateDir } from "../project/state-resolve.js";

export interface OrchestratorContext {
  store: ArtifactStore;
  ws: Workspace;
  accounts: Account[];
  quota: QuotaTracker;
  quotaPath: string;
  runner: CliRunner;
  tracker: FlowTracker;
  checks: string[];
  projectRules: string;
}

export function assembleChecks(detected: ProjectChecks, opts?: { lint?: boolean }): string[] {
  return [
    detected.typecheck,
    opts?.lint === true ? detected.lint : undefined,
    detected.test,
  ].filter((cmd): cmd is string => Boolean(cmd));
}

export async function createContext(repoRoot: string, kunpengHome: string): Promise<OrchestratorContext> {
  const store = new ArtifactStore(join(repoRoot, ".kunpeng", "artifacts"));
  const ws = new Workspace(repoRoot);
  await ws.reclaimDeadLocks().catch(() => {});
  const accounts = await loadAccounts({ home: kunpengHome });
  const quotaPath = join(kunpengHome, ".kunpeng", "quota.json");
  const quota = await loadQuota(quotaPath);
  quota.applyAccountConfig(accounts);
  const backendConfig = await loadBackendConfig(join(repoRoot, ".kunpeng", "backends.json")).catch(() => undefined);
  const flowOptions = readFlowOptions(repoRoot);
  if (flowOptions.error) console.warn(`[flow-options] ${flowOptions.error}`);
  const runner = new CliRunner({
    accounts,
    quota,
    quotaPath,
    backendRouting: backendConfig?.routing as Partial<Record<Stage, Backend>> | undefined,
    ...(flowOptions.options.execBackend ? { execBackend: flowOptions.options.execBackend } : {}),
  });
  const tracker = new FlowTracker(resolveProjectStateDir(repoRoot));
  await reconcileDeadFlows(tracker).catch(() => {});
  await reconcileGhostMergeGates(repoRoot).catch(() => {}); // 幽灵门自愈：清掉分支已被 main 吸收却还挂着的合并门
  const detected = await detectChecks(repoRoot);
  const cfg: unknown = await readFile(join(repoRoot, ".kunpeng", "checks.json"), "utf8")
    .then((raw) => JSON.parse(raw) as unknown)
    .catch(() => ({}));
  const checks = assembleChecks(detected, {
    lint: typeof cfg === "object" && cfg !== null && "lint" in cfg && cfg.lint === true,
  });
  const [agentsRules, claudeRules, conventions] = await Promise.all([
    readFile(join(repoRoot, "AGENTS.md"), "utf8").catch(() => ""),
    readFile(join(repoRoot, "CLAUDE.md"), "utf8").catch(() => ""),
    readFile(join(repoRoot, ".kunpeng", "constitution", "conventions.md"), "utf8").catch(() => ""),
  ]);
  const projectRules = [
    agentsRules,
    claudeRules,
    conventions ? `# 演进约定（自进化沉淀，必须遵守）\n\n${conventions}` : "",
  ].filter(Boolean).join("\n\n---\n\n");

  return { store, ws, accounts, quota, quotaPath, runner, tracker, checks, projectRules };
}
