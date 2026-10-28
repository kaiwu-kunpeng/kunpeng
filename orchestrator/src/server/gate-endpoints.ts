import { basename, join } from "node:path";
import type { WorkspaceDriver } from "../loop/workspace-driver.js";
import { gateCardsFromSnapshots, type GateCardData } from "./chat-commands.js";
import { searchSkills, skillsRoot, type SkillEntry } from "../skills/registry.js";
import { ArtifactStore } from "../artifacts/store.js";
import { collectState, listFlowsCached } from "./state.js";
import { currentProfileId } from "./auth-context.js";
import { kunpengStateDir, readProjectSelf, readRegistry, type ProjectEntry } from "../project/registry.js";
import { readProfileRegistry } from "../project/registry-profile.js";

async function fallbackGateProject(cwd: string, workspaceId: string): Promise<ProjectEntry> {
  const self = await readProjectSelf(cwd);
  return {
    id: self?.id ?? workspaceId,
    name: self?.name ?? basename(cwd),
    repoPath: cwd,
    registeredAt: self?.registeredAt ?? 0,
  };
}

async function gateProjectsForChat(cwd: string, workspaceId: string): Promise<ProjectEntry[]> {
  const profileId = currentProfileId();
  if (profileId) {
    const projects = readProfileRegistry(join(kunpengStateDir(), "profiles", profileId, "projects.json"));
    return projects.length > 0 ? projects : [await fallbackGateProject(cwd, workspaceId)];
  }
  const projects = await readRegistry(kunpengStateDir());
  return projects.length > 0 ? projects : [await fallbackGateProject(cwd, workspaceId)];
}

/** 复用首页 humanGates/flow 真相源；任一读取失败都向命令显式报错。 */
export async function listPendingGateCards(cwd: string, workspaceId: string): Promise<GateCardData[]> {
  const projects = await gateProjectsForChat(cwd, workspaceId);
  const snapshots = await Promise.all(projects.map(async (project) => {
    const [state, flows] = await Promise.all([
      collectState(new ArtifactStore(join(project.repoPath, ".kunpeng", "artifacts")), project.repoPath),
      listFlowsCached(project.repoPath),
    ]);
    return {
      id: project.id,
      name: project.name || project.id,
      state: { humanGates: state.humanGates, flows },
    };
  }));
  return gateCardsFromSnapshots(snapshots);
}

export function findEnabledSkill(id: string): SkillEntry | undefined {
  return searchSkills(skillsRoot(), "", { enabled: true }).find((skill) => skill.id === id);
}

export function splitSkillRequest(rest: string): { id: string; task: string } | null {
  const matched = /^(\S+)(?:\s+([\s\S]*))?$/.exec(rest.trim());
  if (!matched) return null;
  return { id: matched[1], task: (matched[2] ?? "").trim() };
}

export async function handleGate(
  driver: Pick<WorkspaceDriver, "answerGate">,
  workspaceId: string,
  body: { gateId?: unknown; decision?: unknown },
): Promise<{ ok: boolean; error?: string }> {
  if (typeof body.gateId !== "string" || body.gateId.length === 0) {
    return { ok: false, error: "gateId must be a non-empty string" };
  }
  if (body.decision !== "yes" && body.decision !== "no") {
    return { ok: false, error: "decision must be yes or no" };
  }

  await driver.answerGate(workspaceId, body.gateId, body.decision);
  return { ok: true };
}
