import { isHardGateLevel } from "../policy/action-levels.js";
import type { ReviewItem } from "./state-types.js";

/** 收件箱三栏（开悟 #3 / 审计 P1-10）：机器先说自己的把握，人只在「拿不准」那栏花时间。 */
export const INBOX_LANES = [
  { id: "release", title: "AI 建议放行", confidence: "can" },
  { id: "judge", title: "需要你判断", confidence: "unsure" },
  { id: "reject", title: "建议驳回", confidence: "shouldnt" },
] as const;
export type InboxLaneId = (typeof INBOX_LANES)[number]["id"];
/** 把握只有三档：能办 / 拿不准 / 不该办；「拿不准」必须接「还缺：__」。 */
export type InboxConfidence = "can" | "unsure" | "shouldnt";
/** 触发方：规则（宪法门 / 分级表 / 守门）还是 AI（预审 / 判官）。 */
export type InboxTriggeredBy = "rule" | "ai";

export interface InboxTriage {
  /** 来由枚举：合并门规则 id（sensitive-path / guard-red / …）或条目种类。 */
  origin: string;
  triggeredBy: InboxTriggeredBy;
  confidence: InboxConfidence;
  /** confidence=unsure 时必填：机器还缺什么才能自己判。 */
  missing?: string;
}

export const INBOX_ORIGIN_LABELS: Readonly<Record<string, string>> = {
  "merge-gate": "合并门（C5#1）",
  "sensitive-path": "敏感路径",
  "public-surface": "公共面改动",
  "pre-review-reject": "预审拒绝",
  "guard-red": "守门碰红",
  "baseline-green": "基线已绿存疑",
  "no-red-first-evidence": "无先红证据",
  "empty-diff": "空 diff",
  "large-diff": "大改动",
  proposal: "进化提案（C5#2）",
  release: "对外发布（C5#3）",
  connector: "第三方登录态（C5#3）",
  "ops-gate": "运营杠杆门",
  failed: "流失败未恢复",
  blocked: "流卡点",
  alert: "看门狗",
  budget: "预算告警",
};

export function originLabel(origin: string): string {
  return INBOX_ORIGIN_LABELS[origin] ?? origin;
}

export function confidenceLabel(confidence: InboxConfidence): string {
  return confidence === "can" ? "能办" : confidence === "shouldnt" ? "不该办" : "拿不准";
}

export function laneOf(confidence: InboxConfidence): InboxLaneId {
  return confidence === "can" ? "release" : confidence === "shouldnt" ? "reject" : "judge";
}

const NOTIFICATION_KINDS: ReadonlySet<ReviewItem["kind"]> = new Set(["failed", "blocked", "alert", "budget"]);

/** 纯判定：从条目已有字段（预审 / 等级 / 过期 / 合并门命中规则）算出来由、触发方、把握与还缺什么。 */
export function triageReviewItem(item: ReviewItem, ctx: { ruleIds?: readonly string[] } = {}): InboxTriage {
  const pr = item.preReview;
  const normalFindings = pr?.findings?.normal?.length ?? 0;
  const aiFlagged = pr?.verdict === "reject" || normalFindings > 0;
  const triggeredBy: InboxTriggeredBy = aiFlagged ? "ai" : "rule";
  const origin = item.kind === "merge" ? (ctx.ruleIds?.[0] ?? "merge-gate") : item.kind;
  const level = item.decision?.blastRadius;

  if (aiFlagged) {
    return { origin, triggeredBy, confidence: "shouldnt" };
  }
  if (NOTIFICATION_KINDS.has(item.kind)) {
    return { origin, triggeredBy, confidence: "unsure", missing: "通知类条目：机器只报不判，需要你决定是否介入" };
  }
  if (item.decision?.expired) {
    return { origin, triggeredBy, confidence: "unsure", missing: "门已过期，需重新核对改动是否仍适用" };
  }
  if (item.kind === "proposal") {
    return { origin, triggeredBy, confidence: "unsure", missing: "宪法/角色卡改动属人工门 #2，机器不能替你固化" };
  }
  if (item.kind === "release" || item.kind === "connector" || item.kind === "ops-gate" || isHardGateLevel(level)) {
    return { origin, triggeredBy, confidence: "unsure", missing: `${level ?? "L3"} 对外可见，属 C5 第三类，须人工确认` };
  }
  if (pr?.verdict === "approve") {
    return { origin, triggeredBy, confidence: "can" };
  }
  if (pr?.verdict === "review") {
    return { origin, triggeredBy, confidence: "unsure", missing: `预审拿不准：${pr.reason}` };
  }
  return { origin, triggeredBy, confidence: "unsure", missing: "无预审结论（预审未跑或失败）" };
}

export function groupByLane<T extends { triage?: InboxTriage }>(items: readonly T[]): Array<{ lane: (typeof INBOX_LANES)[number]; items: T[] }> {
  return INBOX_LANES
    .map((lane) => ({ lane, items: items.filter((item) => laneOf(item.triage?.confidence ?? "unsure") === lane.id) }))
    .filter((group) => group.items.length > 0);
}
