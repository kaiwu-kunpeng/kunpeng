import { mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { reapAgentRegistry } from "./agent-registry-reap.js";
import { inferProjectFromPath } from "../project/infer.js";
import { PresenceStore } from "../switchboard/presence.js";
import type { InferDeps } from "../project/infer.js";

export interface AgentRegistryRecord {
  iso: string;
  instance: string;
  projectId: string;
  cwd: string;
  task: string;
  pid?: number;
  host?: string;
}

export function formatAgentRegistryRecord(record: AgentRegistryRecord): string {
  const liveness = record.pid === undefined ? "" : ` ｜ pid=${record.pid} host=${record.host ?? ""}`;
  return `- [${record.iso}] ${record.instance} @ ${record.projectId} ｜ ${record.cwd} ｜ ${record.task}${liveness}\n`;
}

export function agentRegistryRecordFileName(iso: string, instance: string): string {
  const safeIso = iso.replace(/[:/\\]/g, "-");
  const safeInstance = instance.replace(/[^A-Za-z0-9._-]/g, "-");
  return `${safeIso}-${safeInstance}.md`;
}

export interface RegisterAgentInput {
  instance: string;
  cwd: string;
  task: string;
  pid?: number;
  now: number;
  presence: PresenceStore;
  inferDeps?: InferDeps;
  /** 只刷 presence 心跳（带 projectId/worktree/task），不追加 agents-active 登记：供 UserPromptSubmit hook 每轮续命用。 */
  beatOnly?: boolean;
}

export interface RegisterAgentResult {
  projectId: string | null;
  projectName: string | null;
  mdPath: string | null;
}

export async function registerAgent(input: RegisterAgentInput): Promise<RegisterAgentResult> {
  const proj = inferProjectFromPath(input.cwd, input.inferDeps);
  await input.presence.beat(input.instance, input.now, {
    projectId: proj?.id,
    worktree: input.cwd,
    task: input.task,
  });

  if (!proj) {
    return { projectId: null, projectName: null, mdPath: null };
  }
  if (input.beatOnly === true) {
    return { projectId: proj.id, projectName: proj.name, mdPath: null };
  }

  const iso = new Date(input.now).toISOString();
  const registryDir = join(proj.repoPath, ".kunpeng", "agents-active");
  const baseName = agentRegistryRecordFileName(iso, input.instance);
  const stem = baseName.slice(0, -3);
  const host = hostname();
  const record = formatAgentRegistryRecord({
    iso,
    instance: input.instance,
    projectId: proj.id,
    cwd: input.cwd,
    task: input.task,
    pid: input.pid ?? process.pid,
    host,
  });
  mkdirSync(registryDir, { recursive: true });
  reapAgentRegistry(registryDir);

  let attempt = 1;
  let mdPath: string;
  while (true) {
    const fileName = attempt === 1 ? baseName : `${stem}-${attempt}.md`;
    mdPath = join(registryDir, fileName);
    try {
      writeFileSync(mdPath, record, { encoding: "utf8", flag: "wx" });
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
      attempt += 1;
    }
  }

  return { projectId: proj.id, projectName: proj.name, mdPath };
}
