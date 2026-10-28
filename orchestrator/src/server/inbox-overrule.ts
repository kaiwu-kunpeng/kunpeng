import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ArtifactStore } from "../artifacts/store.js";
import type { Artifact } from "../artifacts/types.js";
import { classifyActionLevel } from "../policy/action-levels.js";
import type { FlowState } from "../runtime/flowstate.js";
import { originLabel, triageReviewItem, type InboxConfidence, type InboxTriage } from "./inbox-triage.js";
import type { ReviewItem } from "./state-types.js";

export type OverruleKind = "approved-shouldnt" | "rejected-can";
type OverruleDecision = "approve" | "reject";
type MergeFlow = Pick<FlowState, "flowId" | "humanGate" | "mergeTier">;

export interface OverruleRecord {
  at: number;
  kind: OverruleKind;
  itemKind: ReviewItem["kind"];
  itemId: string;
  via: string;
  who?: string;
  projectId?: string;
  note?: string;
  triage: InboxTriage;
}

export function detectOverrule(confidence: InboxConfidence | undefined, decision: OverruleDecision): OverruleKind | undefined {
  if (confidence === "shouldnt" && decision === "approve") return "approved-shouldnt";
  if (confidence === "can" && decision === "reject") return "rejected-can";
  return undefined;
}

/** 与收件箱聚合共用三栏判定；调用方须传清门前的流快照。 */
export function triageMergeFlow(flow: MergeFlow): InboxTriage {
  return triageReviewItem({
    kind: "merge", id: flow.flowId, projectId: "", projectName: "",
    title: flow.humanGate?.gate ?? "", detail: flow.humanGate?.what ?? "",
    preReview: flow.humanGate?.preReview as ReviewItem["preReview"],
    decision: {
      action: "merge-main",
      blastRadius: classifyActionLevel({ externallyVisible: flow.mergeTier?.tier === "human", reversible: true }),
    },
  }, { ruleIds: flow.mergeTier?.ruleIds });
}

export function buildOverruleProposal(record: OverruleRecord): Artifact {
  const fact = record.kind === "approved-shouldnt" ? "机器判「不该办」，你批准了" : "机器判「能办」，你驳回了";
  return {
    kind: "proposal", status: "draft",
    id: `ovr-${record.kind}-${record.itemId}-${record.at.toString(36)}`,
    body: [
      `${fact}（${record.via}${record.who ? ` · ${record.who}` : ""}）`,
      `改判条目：${record.itemKind} · ${record.itemId}${record.projectId ? ` · 项目 ${record.projectId}` : ""}`,
      `机器来由：${originLabel(record.triage.origin)}（${record.triage.origin}）；触发方：${record.triage.triggeredBy === "ai" ? "AI" : "规则"}`,
      ...(record.triage.missing ? [`还缺：${record.triage.missing}`] : []),
      ...(record.note ? [`人给的理由：${record.note}`] : []),
      "",
      "请选择一种方式整理这次改判：",
      "1. 做成规则：明确适用条件与例外，起草规则 diff。",
      "2. 禁用词：标出误导机器判断的措辞及替代说法。",
      "3. 回归样例：保留本次事实与人的决定，作为后续验收样例。",
      "",
      "本提案仅为草稿，须经人工门 #2（C6），不得自动批准或固化。",
    ].join("\n"),
    meta: { overrule: record },
  };
}

export function overruleLedgerPath(stateDir: string): string {
  return join(stateDir, "inbox-overrules.jsonl");
}

export async function recordOverrule(stateDir: string, record: OverruleRecord): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await appendFile(overruleLedgerPath(stateDir), JSON.stringify(record) + "\n", "utf8");
}

export async function fileOverrule(repoRoot: string, stateDir: string, record: OverruleRecord): Promise<string> {
  await recordOverrule(stateDir, record);
  const proposal = buildOverruleProposal(record);
  await new ArtifactStore(join(repoRoot, ".kunpeng", "artifacts")).write(proposal);
  return proposal.id;
}

export async function fileMergeOverruleIfAny(input: {
  repoRoot: string;
  stateDir: string;
  flow: MergeFlow | null | undefined;
  decision: OverruleDecision;
  via: string;
  who?: string;
  projectId?: string;
  now?: number;
}): Promise<string | undefined> {
  if (!input.flow?.humanGate) return undefined;
  const triage = triageMergeFlow(input.flow);
  const kind = detectOverrule(triage.confidence, input.decision);
  if (!kind) return undefined;
  return fileOverrule(input.repoRoot, input.stateDir, {
    at: input.now ?? Date.now(), kind, itemKind: "merge", itemId: input.flow.flowId,
    via: input.via, triage,
    ...(input.who ? { who: input.who } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
  });
}
