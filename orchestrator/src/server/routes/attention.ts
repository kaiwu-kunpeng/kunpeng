import { basename, dirname, join } from "node:path";
import { ArtifactStore } from "../../artifacts/store.js";
import { cliJsPath } from "../../cli-commands/shared.js";
import { readProfileRegistry, type ProfileProjectEntry } from "../../project/registry-profile.js";
import { readProjectSelf } from "../../project/registry.js";
import { currentProfileId } from "../auth-context.js";
import { InboxDismissStore } from "../inbox-dismiss-store.js";
import {
  aggregateReviewQueue,
  collectMultiState,
  collectStateCached,
  type ProjectSnapshot,
  type ReviewItem,
} from "../state.js";
import { findEscalations, type Escalation } from "../../switchboard/escalation.js";
import { distStaleTitle, measureDistFreshness, type DistFreshness } from "../../runtime/dist-freshness.js";
import { SwitchboardStore } from "../../switchboard/store.js";
import { PresenceStore } from "../../switchboard/presence.js";
import { registerModularRoute, type RouteContext } from "./registry.js";

export interface AttentionItem {
  kind: string;
  title: string;
  href: string;
}

async function snapshotProject(project: ProfileProjectEntry): Promise<ProjectSnapshot | null> {
  try {
    const state = await collectStateCached(
      new ArtifactStore(join(project.repoPath, ".kunpeng", "artifacts")),
      project.repoPath,
    );
    return {
      id: project.id,
      name: project.name || project.id,
      repoPath: project.repoPath,
      state,
    };
  } catch {
    return null;
  }
}

async function profileSnapshots(stateDir: string, profileId: string): Promise<ProjectSnapshot[]> {
  const projects = readProfileRegistry(join(stateDir, "profiles", profileId, "projects.json"));
  const snapshots = await Promise.all(projects.map(snapshotProject));
  return snapshots.filter((snapshot): snapshot is ProjectSnapshot => snapshot !== null);
}

async function singleSnapshot(repoRoot: string): Promise<ProjectSnapshot> {
  const self = await readProjectSelf(repoRoot);
  const state = await collectStateCached(
    new ArtifactStore(join(repoRoot, ".kunpeng", "artifacts")),
    repoRoot,
  );
  return {
    id: self?.id ?? "current",
    name: self?.name ?? basename(repoRoot),
    repoPath: repoRoot,
    state,
  };
}

async function attentionSnapshots(context: RouteContext): Promise<ProjectSnapshot[]> {
  const profileId = currentProfileId();
  if (profileId) return profileSnapshots(context.stateDir, profileId);

  const registered = await collectMultiState(context.stateDir);
  if (registered.length > 0) return registered;
  return [await singleSnapshot(context.repoRoot ?? process.cwd())];
}

function reviewAttentionItem(item: ReviewItem): AttentionItem {
  return {
    kind: item.kind || "gate",
    title: item.title.trim() || item.id.trim() || "待处理事项",
    href: "#/inbox",
  };
}

function escalationAttentionItem(escalation: Escalation): AttentionItem {
  const firstLine = (escalation.message.body ?? "").split("\n")[0]?.trim() ?? "";
  let title: string;
  if (!firstLine) {
    title = `紧急消息 ${escalation.message.from}`;
  } else if (firstLine.length > 60) {
    title = `${firstLine.slice(0, 60)}…`;
  } else {
    title = firstLine;
  }
  return { kind: "escalation", title, href: "#/switchboard" };
}

export function attentionItemsFromSnapshots(
  snapshots: ProjectSnapshot[],
  dismissed?: Set<string>,
  escalations?: readonly Escalation[],
  distFreshness?: DistFreshness,
): AttentionItem[] {
  const staleDistItems: AttentionItem[] =
    distFreshness?.stale
      ? [{ kind: "stale-dist", title: distStaleTitle(distFreshness), href: "#/overview" }]
      : [];
  const escalationItems = (escalations ?? []).map(escalationAttentionItem);
  const reviewQueue = aggregateReviewQueue(snapshots, { now: Date.now(), dismissed });
  const items = reviewQueue.map(reviewAttentionItem);
  const representedGates = new Set(reviewQueue.map((item) => `${item.projectId}\u0000${item.id}`));

  for (const snapshot of snapshots) {
    for (const gate of snapshot.state.humanGates ?? []) {
      if (representedGates.has(`${snapshot.id}\u0000${gate.flowId}`)) continue;
      items.push({
        kind: "gate",
        title: gate.what.trim() || gate.detail.trim() || gate.flowId.trim() || "待人工裁决",
        href: "#/inbox",
      });
    }
    for (const blocker of snapshot.state.blockers ?? []) {
      if (dismissed?.has(`blocked:${blocker.flowId}`)) continue;
      items.push({
        kind: "blocked",
        title: blocker.reason.trim() || blocker.flowId.trim() || "等待输入",
        href: `#/project/${encodeURIComponent(snapshot.id)}`,
      });
    }
  }

  return [...staleDistItems, ...escalationItems, ...items].slice(0, 20);
}

async function collectEscalations(context: RouteContext): Promise<Escalation[]> {
  try {
    const now = Date.now();
    const store = new SwitchboardStore(join(context.stateDir, "switchboard"));
    const online = await new PresenceStore(join(context.stateDir, "presence")).online(now);
    return findEscalations({ messages: await store.list(), online, now });
  } catch {
    return [];
  }
}

registerModularRoute({
  method: "GET",
  path: "/api/attention",
  handle: async (_req, res, _url, context) => {
    const dismissed = await new InboxDismissStore(
      join(context.stateDir, "inbox-dismissed.json"),
    ).getDismissed();
    const escalations = await collectEscalations(context);
    const distFreshness = await measureDistFreshness({
      repoRoot: join(dirname(cliJsPath()), "..", ".."),
      distEntry: cliJsPath(),
    }).catch(() => undefined);
    const items = attentionItemsFromSnapshots(await attentionSnapshots(context), dismissed, escalations, distFreshness);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ waiting: items.length, items }));
  },
});
