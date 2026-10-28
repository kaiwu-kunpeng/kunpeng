import { isRecord } from "../util/is-record.js";
import { errorMessage } from "../util/errors.js";

export interface LandingDeps {
  createTask: (task: unknown) => Promise<{ id: string }>;
  transition: (id: string, to: string) => Promise<unknown>;
  projectId?: string;
}

export interface LandingReport {
  landed: Array<{ proposalId: string; taskId: string; channel: string }>;
  skipped: Array<{ proposalId: string; reason: string }>;
}

interface ProposalLike {
  id: string;
  status: string;
  body?: string;
  meta?: unknown;
}

interface ProposalMeta {
  channel?: unknown;
  title?: unknown;
  changes?: unknown;
}

function proposalMeta(meta: unknown): ProposalMeta | null {
  if (!isRecord(meta)) return null;
  const proposal = meta.proposal;
  if (!isRecord(proposal)) return null;
  return proposal;
}

function channelOf(p: { meta?: unknown }): string | null {
  const channel = proposalMeta(p.meta)?.channel;
  return typeof channel === "string" && channel.trim() ? channel.trim() : null;
}

function changesOf(p: { meta?: unknown }): unknown {
  return proposalMeta(p.meta)?.changes;
}

export function isChannelProposalWithoutChanges(p: { meta?: unknown }): boolean {
  const channel = channelOf(p);
  if (channel === null) return false;
  const changes = changesOf(p);
  return changes === undefined || (Array.isArray(changes) && changes.length === 0);
}

function typeForChannel(channel: string): string {
  const types: Record<string, string> = {
    security: "security-fix",
    module: "module-health",
    ears: "research-adopt",
    official: "official-follow-up",
  };
  return types[channel] ?? "channel-follow-up";
}

function titleForProposal(proposal: ProposalLike): string {
  const title = proposalMeta(proposal.meta)?.title;
  if (typeof title === "string" && title.trim()) return title.trim();
  const firstLine = proposal.body?.split("\n")[0]?.trimStart().replace(/^#+\s*/, "").trim();
  return firstLine || proposal.id;
}

function goalForProposal(proposal: ProposalLike, title: string): string {
  return proposal.body ? proposal.body.slice(0, 500) : title;
}

export async function landApprovedChannelProposals(
  proposals: ProposalLike[],
  deps: LandingDeps,
): Promise<LandingReport> {
  const landed: LandingReport["landed"] = [];
  const skipped: LandingReport["skipped"] = [];

  for (const proposal of proposals) {
    if (proposal.status !== "approved") continue;

    const changes = changesOf(proposal);
    if (Array.isArray(changes) && changes.length > 0) {
      skipped.push({ proposalId: proposal.id, reason: "has-changes" });
      continue;
    }

    if (!isChannelProposalWithoutChanges(proposal)) {
      continue;
    }

    const channel = channelOf(proposal);
    if (channel === null) continue;

    const title = titleForProposal(proposal);
    const acceptanceCriteria = [`处理完成后归档提案 ${proposal.id}`];
    if (channel === "security") {
      acceptanceCriteria.push("跑 npm audit 确认漏洞数下降");
    }

    try {
      const task = await deps.createTask({
        title,
        type: typeForChannel(channel),
        status: "ready",
        projectId: deps.projectId ?? "",
        goal: goalForProposal(proposal, title),
        acceptanceCriteria,
      });
      try {
        await deps.transition(proposal.id, "in-progress");
        await deps.transition(proposal.id, "verified");
      } catch {
        // Landing is task-first: proposal transition failure must not roll back the task.
      }
      landed.push({ proposalId: proposal.id, taskId: task.id, channel });
    } catch (error) {
      skipped.push({ proposalId: proposal.id, reason: errorMessage(error) });
    }
  }

  return { landed, skipped };
}
