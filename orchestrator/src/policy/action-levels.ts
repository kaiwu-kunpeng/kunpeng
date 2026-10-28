export const ACTION_LEVELS = ["L0", "L1", "L2", "L3", "L4"] as const;
export type ActionLevel = (typeof ACTION_LEVELS)[number];
export type GateKind = "none" | "auto" | "soft" | "hard";

export interface ActionLevelRow {
  level: ActionLevel;
  label: string;
  summary: string;
  gate: GateKind;
  secondConfirm: boolean;
  syntheticEvidenceOk: boolean;
}

export const ACTION_LEVEL_TABLE: readonly ActionLevelRow[] = [
  {
    level: "L0", label: "只读", summary: "读取、抓取、度量；不产生副作用",
    gate: "none", secondConfirm: false, syntheticEvidenceOk: true,
  },
  {
    level: "L1", label: "出草稿", summary: "生成建议、草稿、提案；不落地",
    gate: "none", secondConfirm: false, syntheticEvidenceOk: true,
  },
  {
    level: "L2", label: "有界自动", summary: "可逆、范围内、不花钱的自动改动（含走合并门的合并）",
    gate: "auto", secondConfirm: false, syntheticEvidenceOk: false,
  },
  {
    level: "L3", label: "对外可见但可逆", summary: "命中 C5 第三类（对外发布或操控第三方登录态）但可逆；证据须为真实遥测或人工产出",
    gate: "soft", secondConfirm: false, syntheticEvidenceOk: false,
  },
  {
    level: "L4", label: "对外可见且不可逆或花钱", summary: "命中 C5 第三类且不可逆或花钱；硬门，二次确认",
    gate: "hard", secondConfirm: true, syntheticEvidenceOk: false,
  },
];

export function actionLevelRow(level: ActionLevel): ActionLevelRow {
  const row = ACTION_LEVEL_TABLE.find((row) => row.level === level);
  if (!row) throw new Error(`Unknown action level: ${level}`);
  return row;
}

export function isActionLevel(x: unknown): x is ActionLevel {
  return ACTION_LEVELS.some((level) => level === x);
}

export function isHardGateLevel(level: ActionLevel | undefined): boolean {
  if (level === undefined) return false;
  const { gate } = actionLevelRow(level);
  return gate === "soft" || gate === "hard";
}

export function needsSecondConfirm(level: ActionLevel | undefined): boolean {
  return level === undefined ? false : actionLevelRow(level).secondConfirm;
}

export function levelPriority(level: ActionLevel | undefined): number {
  return level === undefined ? ACTION_LEVELS.length : ACTION_LEVELS.length - 1 - ACTION_LEVELS.indexOf(level);
}

export const MAX_LEVEL_FOR_SYNTHETIC_EVIDENCE: ActionLevel = "L1";

export function syntheticEvidenceAllowed(level: ActionLevel): boolean {
  return actionLevelRow(level).syntheticEvidenceOk;
}

export function classifyActionLevel(t: {
  readOnly?: boolean;
  draftOnly?: boolean;
  externallyVisible?: boolean;
  thirdPartyAuth?: boolean;
  reversible?: boolean;
  spendsMoney?: boolean;
}): ActionLevel {
  if (t.readOnly) return "L0";
  if (t.draftOnly) return "L1";
  if (t.externallyVisible || t.thirdPartyAuth) {
    return t.reversible === false || t.spendsMoney ? "L4" : "L3";
  }
  return "L2";
}

export function renderActionLevelTable(): string {
  const gateLabels: Record<GateKind, string> = {
    none: "无门",
    auto: "自动放行（合并门等机器门）",
    soft: "软门（人批一次）",
    hard: "硬门（二次确认）",
  };
  return [
    "| 等级 | 名称 | 含义 | 门 |",
    "|---|---|---|---|",
    ...ACTION_LEVEL_TABLE.map((row) => `| ${row.level} | ${row.label} | ${row.summary} | ${gateLabels[row.gate]} |`),
  ].join("\n");
}
