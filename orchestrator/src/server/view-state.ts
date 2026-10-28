import type { ServerResponse } from "node:http";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { ArtifactStore } from "../artifacts/store.js";
import { listTemplates, solutionsRoot } from "../loop/solution-template.js";
import { listSkills, skillsRoot } from "../skills/registry.js";
import { kunpengStateDir } from "../project/registry.js";
import { readActivity } from "../product/activity-log.js";
import { listCheckpoints } from "../product/loop-checkpoint.js";
import { readFeedbackSummary, readOpsSummary } from "../product/ops-kit.js";
import { estimateCostUsd } from "../runtime/cost-pricing.js";
import { currentProfileId } from "./auth-context.js";
import { collectDossierOverview } from "./dossier-state.js";
import { eventLoopLag } from "./event-loop-monitor.js";
import { InboxDeferStore } from "./inbox-defer-store.js";
import { InboxDismissStore } from "./inbox-dismiss-store.js";
import { InboxSeenStore } from "./inbox-seen-store.js";
import { budgetReviewItem, loadCostBudget } from "./inbox-budget.js";
import { loadInboxPolicy } from "./inbox-policy.js";
import { profileProjects, resolveRepo } from "./project-scope.js";
import { collectDashboardState, singleSnapshot, snapshotsForProjects } from "./snapshots.js";
import { aggregateOverviewBase } from "./state-snapshot-aggregates.js";
import {
  aggregateBlockers,
  aggregateCrossProjectActivity,
  aggregateCrossProjectRunning,
  aggregateHumanGates,
  aggregateLoops,
  aggregateOpsGates,
  aggregateOpsReports,
  aggregatePlaybooks,
  aggregateQualityGateStats,
  aggregateReviewQueue,
  buildActivityByProject,
  buildCostByProject,
  buildDocsOverview,
  buildSkillsOverview,
  buildSolutionsOverview,
  collectMultiState,
  collectState,
  collectStateCached,
  readProductSessionViewForSlug,
  sumProjectCosts,
  type SkillCatalogSource,
} from "./state.js";

type DashboardOpts = { repoRoot?: string; stateDir?: string };

export function pickDossierRepoPath(snaps: { id?: string; repoPath?: string }[]): string | undefined {
  const selfPath = snaps.find(
    (snapshot) => snapshot?.id === "kunpeng" && Boolean(snapshot.repoPath?.trim()),
  )?.repoPath;
  if (selfPath) return selfPath;
  return snaps.find((snapshot) => Boolean(snapshot?.repoPath?.trim()))?.repoPath;
}

export function repoProjectName(repoRoot: string): string {
  return basename(repoRoot);
}

export function isForbiddenProject(projectId: string, opts: DashboardOpts): boolean {
  const profileId = currentProfileId();
  if (!profileId || !projectId) return false;
  try {
    const projects = profileProjects(profileId, opts.stateDir);
    if (!projects.some((project) => project.id === projectId)) throw new Error(`FORBIDDEN_PROJECT:${projectId}`);
    return false;
  } catch (error) {
    return String((error as Error).message ?? error).startsWith("FORBIDDEN_PROJECT:");
  }
}

export function sendForbiddenProject(res: ServerResponse): void {
  res.statusCode = 403;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: false, error: "无权访问该项目" }));
}

function safeListSkills(): SkillCatalogSource[] {
  try {
    return listSkills(skillsRoot(process.env));
  } catch {
    return [];
  }
}

function safeListTemplates(): ReturnType<typeof listTemplates> {
  try {
    return listTemplates(solutionsRoot(process.env));
  } catch {
    return [];
  }
}

export function docsDir(): string {
  return process.env.KUNPENG_DOCS_DIR && process.env.KUNPENG_DOCS_DIR.trim() !== ""
    ? process.env.KUNPENG_DOCS_DIR
    : join(homedir(), "kunpeng-strategy-docs");
}

function safeBuildDocs() {
  try {
    return buildDocsOverview(docsDir());
  } catch {
    return [];
  }
}

export async function collectOverviewState(opts: DashboardOpts) {
  const stateDir = opts.stateDir ?? kunpengStateDir();
  const policy = loadInboxPolicy(join(stateDir, "inbox-policy.json"));
  const seenInboxKeys = [
    ...await new InboxSeenStore(join(opts.stateDir ?? kunpengStateDir(), "inbox-seen.json")).getSeen(),
  ];
  const dismissed = await new InboxDismissStore(
    join(opts.stateDir ?? kunpengStateDir(), "inbox-dismissed.json"),
  ).getDismissed();
  const deferred = await new InboxDeferStore(
    join(opts.stateDir ?? kunpengStateDir(), "inbox-deferred.json"),
  ).getDeferred(Date.now());
  try {
    if (opts.repoRoot) {
      const snaps = await singleSnapshot(opts.repoRoot);
      return {
        ...snaps[0].state,
        skillCatalog: buildSkillsOverview(safeListSkills(), snaps),
        solutionCatalog: buildSolutionsOverview(safeListTemplates()),
        docsCatalog: safeBuildDocs(),
        reviewQueue: aggregateReviewQueue(snaps, { now: Date.now(), dismissed, deferred, policy }),
        inboxPolicy: policy,
        seenInboxKeys,
        dossier: await collectDossierOverview(opts.repoRoot).catch(() => undefined),
        eventLoopLag: eventLoopLag(),
      };
    }
    const profileId = currentProfileId();
    const snaps = profileId
      ? await snapshotsForProjects(profileProjects(profileId, opts.stateDir))
      : await collectMultiState(opts.stateDir ?? "");
    const selfSnap = snaps.find((snapshot) => snapshot.id === "kunpeng")?.state;
    // 本体总览：未被下方聚合覆盖的字段（code/f07/health/systemLight 等）默认取 kunpeng 自身，
    // 而非注册顺序第一个项目——否则总览会串成别项目的数据（曾致「已过审」显示成另一个项目的行数）。
    const base = selfSnap ?? snaps[0]?.state ?? (await singleSnapshot(process.cwd()))[0].state;
    const now = Date.now();
    const costByProject = buildCostByProject(snaps);
    const costSummary = sumProjectCosts(costByProject);
    const reviewQueue = aggregateReviewQueue(snaps, { now: Date.now(), dismissed, deferred, policy });
    const dossierRepoPath = pickDossierRepoPath(snaps);
    const totalUsd = estimateCostUsd(costSummary.tokensByModel).totalUsd;
    const budgetItem = budgetReviewItem(
      costSummary.totalTokens,
      loadCostBudget(join(opts.stateDir ?? kunpengStateDir(), "cost-budget.json")),
      totalUsd,
    );
    if (budgetItem && !dismissed.has(`budget:${budgetItem.id}`) && !deferred.has(`budget:${budgetItem.id}`)) reviewQueue.push(budgetItem);
    return {
      ...base,
      ...aggregateOverviewBase(snaps),
      self: selfSnap ? {
        srcLines: selfSnap.code.srcLines,
        testLines: selfSnap.code.testLines,
        passedLines: selfSnap.code.passedLines,
        completed: selfSnap.code.completed,
        flowsTotal: selfSnap.flowsTotal ?? selfSnap.flows.length,
        plansTotal: selfSnap.plansTotal ?? selfSnap.plans.length,
      } : undefined,
      costSummary,
      qualityGateStats: aggregateQualityGateStats(snaps),
      costByProject,
      loops: aggregateLoops(snaps),
      playbooks: aggregatePlaybooks(snaps),
      opsGates: aggregateOpsGates(snaps),
      humanGates: aggregateHumanGates(snaps),
      blockers: aggregateBlockers(snaps),
      opsReports: aggregateOpsReports(snaps),
      skillCatalog: buildSkillsOverview(safeListSkills(), snaps),
      solutionCatalog: buildSolutionsOverview(safeListTemplates()),
      docsCatalog: safeBuildDocs(),
      running: aggregateCrossProjectRunning(snaps),
      activity: aggregateCrossProjectActivity(snaps, now),
      activityByProject: buildActivityByProject(snaps, now),
      reviewQueue,
      inboxPolicy: policy,
      seenInboxKeys,
      dossier: dossierRepoPath ? await collectDossierOverview(dossierRepoPath).catch(() => undefined) : undefined,
      eventLoopLag: eventLoopLag(),
    };
  } catch {
    return { ...await collectDashboardState(opts), seenInboxKeys };
  }
}

export async function collectProjectDashboardState(opts: DashboardOpts, projectId: string, selectedProductSlug?: string) {
  if (opts.repoRoot) {
    const state = (await singleSnapshot(opts.repoRoot))[0].state;
    if (!selectedProductSlug) return state;
    return await withSelectedProduct(opts.repoRoot, state, selectedProductSlug);
  }
  try {
    const repoPath = await resolveRepo(opts, projectId);
    if (!repoPath) return await collectDashboardState(opts);
    const state = await collectStateCached(new ArtifactStore(join(repoPath, ".kunpeng", "artifacts")), repoPath);
    if (!selectedProductSlug) return state;
    return await withSelectedProduct(repoPath, state, selectedProductSlug);
  } catch {
    return await collectDashboardState(opts);
  }
}

export async function withSelectedProduct(repoPath: string, state: Awaited<ReturnType<typeof collectState>>, slug: string) {
  const sel = await readProductSessionViewForSlug(repoPath, slug);
  if (!sel) return state;
  const productActivity = await readActivity(repoPath, slug);
  const productCheckpoints = await listCheckpoints(repoPath, slug);
  const now = Date.now();
  const [opsSummary, feedback] = await Promise.all([
    readOpsSummary(repoPath, slug, { now }),
    readFeedbackSummary(repoPath, slug, { now }),
  ]);
  const productOpsSummary = opsSummary || feedback
    ? {
      ...(opsSummary ?? { pageviews: 0, errors: 0, topEvents: [], sinceMs: 7 * 86400000 }),
      ...(feedback ? { feedback } : {}),
    }
    : undefined;
  return { ...state, productSession: sel, productActivity, productCheckpoints, productOpsSummary, productSelected: true };
}

export function parseProjectRoute(route: string): { id: string; tab?: string } | undefined {
  if (!route.startsWith("#/project/")) return undefined;

  const parts = route.slice("#/project/".length).split("/");
  if (parts.length < 1 || parts.length > 2 || !parts[0]) return undefined;

  try {
    const id = decodeURIComponent(parts[0]);
    const tab = parts[1] ? decodeURIComponent(parts[1]) : undefined;
    if (!id) return undefined;
    return { id, tab };
  } catch {
    return undefined;
  }
}

export function routeForProjectView(projectRoute: { id: string; tab?: string }): string {
  const id = encodeURIComponent(projectRoute.id);
  const tab = encodeURIComponent(projectRoute.tab ?? "overview");
  return `#/project/${id}/${tab}`;
}

export function isOverviewRoute(route: string): boolean {
  return !parseProjectRoute(route) && route !== "#/inbox" && route !== "#/evolution" && route !== "#/loops";
}
