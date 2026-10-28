import { basename, join } from "node:path";
import { ArtifactStore } from "../artifacts/store.js";
import { readProjectSelf, type ProjectEntry } from "../project/registry.js";
import { currentProfileId } from "./auth-context.js";
import { profileProjects, registeredProjects } from "./project-scope.js";
import { aggregateOverviewBase } from "./state-snapshot-aggregates.js";
import {
  aggregateQualityGateStats,
  collectMultiState,
  collectStateCached,
  type ProjectSnapshot,
} from "./state.js";

export interface ProjectListItem { id: string; name: string }

/** 单项目模式：repoRoot 直出一个快照（读 repo 自描身份，缺省用目录名），不读注册表。 */
export async function singleSnapshot(repoRoot: string): Promise<ProjectSnapshot[]> {
  const store = new ArtifactStore(join(repoRoot, ".kunpeng", "artifacts"));
  const self = await readProjectSelf(repoRoot);
  const state = await collectStateCached(store, repoRoot);
  return [{ id: self?.id ?? "current", name: self?.name ?? basename(repoRoot), repoPath: repoRoot, state }];
}

export async function dashboardProjects(opts: { repoRoot?: string; stateDir?: string }): Promise<ProjectListItem[]> {
  try {
    return (await registeredProjects(opts)).map((project) => ({
      id: project.id,
      name: project.name || project.id,
    }));
  } catch {
    return [];
  }
}

export async function snapshotsForProjects(projects: ProjectEntry[]): Promise<ProjectSnapshot[]> {
  // 并行采集 + 走 collectStateCached（TTL+single-flight），与 collectMultiState 同款；
  // 串行无缓存版本曾让概览/首页每请求 1.9s（6 项目全量重算）。
  const snapshots = await Promise.all(projects.map(async (project): Promise<ProjectSnapshot | null> => {
    try {
      return {
        id: project.id,
        name: project.name || project.id,
        repoPath: project.repoPath,
        state: await collectStateCached(new ArtifactStore(join(project.repoPath, ".kunpeng", "artifacts")), project.repoPath),
      };
    } catch {
      // 单个项目坏状态不应泄漏其它项目，也不应拖垮总览。
      return null;
    }
  }));
  return snapshots.filter((snapshot): snapshot is ProjectSnapshot => snapshot !== null);
}

export async function collectDashboardState(opts: { repoRoot?: string; stateDir?: string }) {
  if (opts.repoRoot) {
    return (await singleSnapshot(opts.repoRoot))[0].state;
  }
  const profileId = currentProfileId();
  const snapshots = profileId
    ? await snapshotsForProjects(profileProjects(profileId, opts.stateDir))
    : await collectMultiState(opts.stateDir ?? "");
  const base = snapshots.find((snapshot) => snapshot.id === "kunpeng")?.state
    ?? snapshots[0]?.state ?? (await singleSnapshot(process.cwd()))[0].state;
  return snapshots.length === 0
    ? base
    : { ...base, ...aggregateOverviewBase(snapshots), qualityGateStats: aggregateQualityGateStats(snapshots) };
}
