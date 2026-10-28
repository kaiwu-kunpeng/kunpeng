export type MergeTier = "auto" | "human";
export type MergeTierMode = "report" | "enforce";
export const MERGE_TIER_LARGE_DIFF_FILES = 40;

export interface MergeTierInput {
  flowId: string;
  changedFiles: readonly string[];
  sensitiveHits: readonly { file: string; label: string }[];
  publicSurfaceTouched: boolean;
  preReviewVerdict?: string;
  redFirst?: boolean;
  baselineGreen?: boolean;
  changedFileCount?: number;
  guardStatus?: "green" | "red" | "skipped" | "pending";
}

export interface MergeTierRule {
  id: string;
  description: string;
  applies: (input: MergeTierInput) => string | null;
}

/** 按顺序收集全部需人审理由；默认只报告，启用 enforce 须宪法 C5 第二类签字。 */
export const MERGE_TIER_RULES: readonly MergeTierRule[] = [
  {
    id: "sensitive-path",
    description: "敏感路径改动需人审",
    applies: (input) => input.sensitiveHits.length > 0
      ? `敏感路径改动：${[...new Set(input.sensitiveHits.map((hit) => hit.label))].join("、")}`
      : null,
  },
  {
    id: "public-surface",
    description: "对外面改动需人审",
    applies: (input) => input.publicSurfaceTouched ? "触及对外面" : null,
  },
  {
    id: "pre-review-reject",
    description: "合并预审拒绝需人审",
    applies: (input) => input.preReviewVerdict === "reject" ? "合并预审拒绝" : null,
  },
  {
    id: "guard-red",
    description: "守门测试失败需人审",
    applies: (input) => input.guardStatus === "red" ? "守门测试碰红" : null,
  },
  {
    id: "baseline-green",
    description: "实现前验收已绿需人审核查验收抓力",
    applies: (input) => input.baselineGreen === true ? "验收在实现前已绿（没先红）" : null,
  },
  {
    id: "no-red-first-evidence",
    description: "缺少实现前基线验收证据需人审",
    applies: (input) => input.redFirst === undefined && input.baselineGreen === undefined
      ? "缺少先红证据（流早于验收2-A 或未跑基线验收）"
      : null,
  },
  {
    id: "empty-diff",
    description: "空改动需人审",
    applies: (input) => input.changedFileCount === 0 ? "改动为空" : null,
  },
  {
    id: "large-diff",
    description: "超过文件数阈值的大改动需人审",
    applies: (input) => {
      const count = input.changedFileCount ?? input.changedFiles.length;
      return count > MERGE_TIER_LARGE_DIFF_FILES
        ? `改动文件数 ${count} 超过 ${MERGE_TIER_LARGE_DIFF_FILES}`
        : null;
    },
  },
];

export function decideMergeTier(input: MergeTierInput): { tier: MergeTier; reasons: string[]; ruleIds: string[] } {
  const reasons: string[] = [];
  const ruleIds: string[] = [];
  for (const rule of MERGE_TIER_RULES) {
    const reason = rule.applies(input);
    if (reason) {
      reasons.push(reason);
      ruleIds.push(rule.id);
    }
  }
  return { tier: reasons.length > 0 ? "human" : "auto", reasons, ruleIds };
}

export function resolveMergeTierMode(env: NodeJS.ProcessEnv): MergeTierMode {
  return env.KUNPENG_MERGE_TIERS?.trim().toLowerCase() === "enforce" ? "enforce" : "report";
}

export function formatMergeTierLine(flowId: string, verdict: ReturnType<typeof decideMergeTier>, mode: MergeTierMode): string {
  return `[autopilot] 分级表(${mode === "enforce" ? "拦" : "只报不判"}) flow=${flowId} tier=${verdict.tier}${verdict.reasons.length ? " · " + verdict.reasons.join("；") : ""}`;
}
