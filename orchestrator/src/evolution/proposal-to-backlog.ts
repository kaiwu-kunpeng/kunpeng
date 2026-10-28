export interface ProposalRoute {
  action: "enqueue" | "reject" | "human";
  requirement?: string;
  reason: string;
}

export interface ProposalEvidence {
  holdoutPassK?: number;
  baseline?: { holdoutPassK?: number };
}

interface PendingProposal {
  id: string;
  title: string;
  channel?: string;
  body?: string;
  changeCount?: number;
  evidence?: ProposalEvidence;
}

export type MarkStatus = "auto-enqueued" | "auto-rejected" | "human-review";

const REJECT_NOISE_REASON = "无具体根因/动作的巡检噪声,按宪法·根因治理原则自动驳回";
const SENSITIVE_WORDS = [
  "constitution",
  "宪法",
  "core.md",
  "secret",
  "credential",
  "凭证",
  "migration",
  "launchd",
  "crontab",
];

function textIncludes(text: string | undefined, needle: string): boolean {
  return (text ?? "").toLowerCase().includes(needle.toLowerCase());
}

function combinedText(p: { title?: string; channel?: string; body?: string }): string {
  return [p.title, p.channel, p.body].filter((value): value is string => Boolean(value)).join("\n");
}

function hasSensitiveWord(p: { title?: string; body?: string }): string | undefined {
  const text = combinedText(p).toLowerCase();
  return SENSITIVE_WORDS.find((word) => text.includes(word.toLowerCase()));
}

function isDependencySecurityProposal(p: { title?: string; channel?: string }): boolean {
  return textIncludes(p.title, "依赖漏洞")
    || textIncludes(p.channel, "依赖漏洞")
    || textIncludes(p.title, "security")
    || textIncludes(p.channel, "security");
}

function dependencyRequirement(title: string | undefined): string {
  return `[proposal-auto] 修复依赖漏洞: ${title ?? "(无标题)"}。只做无损修复(npm audit fix 可自动修的项+受影响 import 的必要适配),破坏性大版本升级不做、单独留人工;修完 npm run typecheck 与受影响测试须绿。`;
}

function isModuleHealthNoise(p: { title?: string; body?: string }): boolean {
  return textIncludes(p.title, "模块健康")
    && (textIncludes(p.title, "需关注") || textIncludes(p.body, "需关注"));
}

function patrolGate(p: {
  id?: string;
  changeCount?: number;
  evidence?: ProposalEvidence;
}): ProposalRoute | undefined {
  if (!p.id?.startsWith("patrol-")) return undefined;
  const holdoutPassK = p.evidence?.holdoutPassK;
  const baseline = p.evidence?.baseline?.holdoutPassK;
  if (typeof holdoutPassK !== "number" || typeof baseline !== "number") {
    return { action: "reject", reason: "巡研提案 Δ=无证据,自动驳回" };
  }
  const delta = holdoutPassK - baseline;
  if (Number.isNaN(delta)) {
    return { action: "reject", reason: "巡研提案 Δ=无证据,自动驳回" };
  }
  if (delta <= 0) {
    return { action: "reject", reason: `巡研提案 Δ=${String(delta)},未取得正向提升,自动驳回` };
  }
  if ((p.changeCount ?? 0) > 5) {
    return { action: "reject", reason: `巡研提案改动 ${p.changeCount} 条超过上限 5 条,自动驳回` };
  }
  return undefined;
}

export function routeProposal(p: {
  id?: string;
  title?: string;
  channel?: string;
  body?: string;
  changeCount?: number;
  evidence?: ProposalEvidence;
}): ProposalRoute {
  const gated = patrolGate(p);
  if (gated) return gated;
  const sensitiveWord = hasSensitiveWord(p);
  if (sensitiveWord) {
    return { action: "human", reason: `命中敏感词 ${sensitiveWord},保守留人工` };
  }

  if (isDependencySecurityProposal(p)) {
    return {
      action: "enqueue",
      requirement: dependencyRequirement(p.title),
      reason: "依赖漏洞提案自动生成修复 requirement 入 backlog",
    };
  }

  if (isModuleHealthNoise(p)) {
    return { action: "reject", reason: REJECT_NOISE_REASON };
  }

  return { action: "human", reason: "无法判定为低风险可执行提案,保守留人工" };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function proposalMetaString(meta: Record<string, unknown>, key: "title" | "channel"): string | undefined {
  const proposal = meta.proposal;
  if (isPlainObject(proposal)) {
    const value = proposal[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  const value = meta[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function pendingFromArtifact(artifact: {
  id: string;
  body: string;
  status: string;
  meta: Record<string, unknown>;
}): PendingProposal {
  const proposal = isPlainObject(artifact.meta.proposal) ? artifact.meta.proposal : {};
  const firstLine = artifact.body.split("\n").find((line) => line.trim());
  const heading = firstLine?.trimStart().replace(/^#+\s*/, "").trim();
  let evidence: ProposalEvidence | undefined;
  if (isPlainObject(proposal.evidence)) {
    evidence = {};
    if (typeof proposal.evidence.holdoutPassK === "number") {
      evidence.holdoutPassK = proposal.evidence.holdoutPassK;
    }
    const baseline = proposal.evidence.baseline;
    if (isPlainObject(baseline) && typeof baseline.holdoutPassK === "number") {
      evidence.baseline = { holdoutPassK: baseline.holdoutPassK };
    }
  }
  return {
    id: artifact.id,
    title: proposalMetaString(artifact.meta, "title") ?? (heading || artifact.id),
    channel: proposalMetaString(artifact.meta, "channel"),
    body: artifact.body,
    changeCount: Array.isArray(proposal.changes) ? proposal.changes.length : 0,
    evidence,
  };
}

export async function markProposalRoute(
  store: {
    read(id: string): Promise<{ status: string }>;
    patchMeta(id: string, meta: Record<string, unknown>): Promise<unknown>;
    transition(id: string, to: "rolled-back"): Promise<unknown>;
  },
  id: string,
  status: MarkStatus,
  reason: string,
): Promise<void> {
  await store.patchMeta(id, { status, routeReason: reason });
  if (status === "auto-rejected" && (await store.read(id)).status === "draft") {
    await store.transition(id, "rolled-back");
  }
}

function statusForAction(action: ProposalRoute["action"]): MarkStatus {
  if (action === "enqueue") return "auto-enqueued";
  if (action === "reject") return "auto-rejected";
  return "human-review";
}

async function markDuplicates(
  proposals: PendingProposal[],
  status: MarkStatus,
  reason: string,
  mark: (id: string, status: MarkStatus, reason: string) => Promise<void>,
): Promise<void> {
  for (const proposal of proposals) {
    try {
      await mark(proposal.id, status, reason);
    } catch {
      // 单个重复项标记失败不得中断整轮 sweep。
    }
  }
}

export async function sweepProposals(deps: {
  listPending: () => Promise<PendingProposal[]>;
  enqueue: (requirement: string) => Promise<void>;
  mark: (
    id: string,
    status: MarkStatus,
    reason: string,
  ) => Promise<void>;
}): Promise<{ enqueued: number; rejected: number; human: number }> {
  const counts = { enqueued: 0, rejected: 0, human: 0 };
  const pending = await deps.listPending();
  const groups = new Map<string, PendingProposal[]>();

  for (const proposal of pending) {
    const key = proposal.title;
    const group = groups.get(key);
    if (group) group.push(proposal);
    else groups.set(key, [proposal]);
  }

  for (const group of groups.values()) {
    const latest = group[group.length - 1];
    if (!latest) continue;
    const duplicates = group.slice(0, -1);

    try {
      const route = routeProposal(latest);
      const status = statusForAction(route.action);
      if (route.action === "enqueue") {
        if (!route.requirement) throw new Error("enqueue route missing requirement");
        await deps.enqueue(route.requirement);
        await deps.mark(latest.id, status, route.reason);
        counts.enqueued += 1;
      } else if (route.action === "reject") {
        await deps.mark(latest.id, status, route.reason);
        counts.rejected += 1;
      } else {
        await deps.mark(latest.id, status, route.reason);
        counts.human += 1;
      }
      await markDuplicates(duplicates, status, route.reason, deps.mark);
    } catch {
      // 单条/单组异常只跳过该标题，不影响后续提案；异常项不计数。
    }
  }

  return counts;
}
