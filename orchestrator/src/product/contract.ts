export interface ProductDefinition {
  idea: string;
  problem: string;
  jobStatement?: string;
  users: string[];
  stories: string[];
  acceptance: string[];
  nonGoals?: string[];
}

export interface ProductOpportunity {
  outcome: string;
  importance: number;
  satisfaction: number;
  opportunityScore: number;
}

export interface ProductDiscovery {
  definition: ProductDefinition;
  jobStatement: string;
  targetUsers: string[];
  alternatives: string[];
  opportunities: ProductOpportunity[];
  syntheticEvidence: boolean;
}

export interface ShapedPitch {
  title: string;
  appetite: string;
  problem: string;
  solution: string;
  buildScope: string[];
  rabbitHoles: string[];
  noGos: string[];
  successMetrics: string[];
}

export type ProductSignalKind = "interview" | "telemetry" | "usage" | "sales" | "support" | "other";

export interface ProductValidationSignal {
  source: string;
  kind: ProductSignalKind;
  summary: string;
  synthetic: boolean;
}

export type ProductValidationDecision = "pivot" | "persevere" | "inconclusive";

export interface ProductValidation {
  hypotheses: string[];
  signals: ProductValidationSignal[];
  decision: ProductValidationDecision;
  rationale: string;
  requiresHumanGate: boolean;
}

export type ProductDefineAnchor =
  | "prfaq-problem"
  | "prfaq-users"
  | "prfaq-scenarios"
  | "prfaq-success"
  | "prfaq-non-goals";

export interface ProductDefineFaqAnchor {
  anchor: ProductDefineAnchor;
  label: string;
  question: string;
}

export interface ProductDefineFaqAnswer {
  anchor: ProductDefineAnchor;
  label: string;
  question: string;
  answer: string;
}

export interface InterviewSession {
  idea: string;
  status: "in-progress" | "done";
  step: number;
  answers: string[];
  definition?: ProductDefinition;
}

/** DEFINE 的 PR FAQ 锚点目录。问题文案从锚点产物派生，避免散落写死。 */
export const PRODUCT_DEFINE_FAQ_ANCHORS: readonly ProductDefineFaqAnchor[] = [
  {
    anchor: "prfaq-problem",
    label: "问题",
    question: "这个产品/功能要解决什么问题？",
  },
  {
    anchor: "prfaq-users",
    label: "目标用户",
    question: "目标用户是谁？",
  },
  {
    anchor: "prfaq-scenarios",
    label: "核心场景",
    question: "核心使用场景是什么？",
  },
  {
    anchor: "prfaq-success",
    label: "成功标准",
    question: "怎样算成功（验收标准）？",
  },
  {
    anchor: "prfaq-non-goals",
    label: "非目标",
    question: "明确不做什么（非目标）？",
  },
];

/** 向后兼容旧的 5 问 API；真实来源是 PRODUCT_DEFINE_FAQ_ANCHORS。 */
export const INTERVIEW_QUESTIONS: readonly string[] = PRODUCT_DEFINE_FAQ_ANCHORS.map((item) => item.question);

export interface NorthStar { outcome: string; metric: string }
export interface OpportunityNode {
  id: string; statement: string; source: string;
  evidence: "real" | "synthetic"; parentId?: string;
}
export interface RiceScore { reach: number; impact: number; confidence: number; effort: number; score: number }
export interface SolutionNode { id: string; opportunityId: string; idea: string; rice?: RiceScore }
export interface OpportunitySolutionTree {
  northStar: NorthStar; opportunities: OpportunityNode[]; solutions: SolutionNode[];
}
export interface OstValidation { ok: boolean; errors: string[]; requiresHumanGate: boolean }

export type ProductNextAction = "build" | "pivot" | "gather-signals";

export interface ProductIteration {
  fromDecision: ProductValidationDecision;
  action: ProductNextAction;
  rationale: string;
  nextSeed?: string;
  requiresHumanGate: boolean;
}

export interface StoryMapTask { title: string; scenarios: string[] }
export interface StoryMapSlice { name: string; goal: string; tasks: StoryMapTask[]; isWalkingSkeleton: boolean }
export type RiskSeverity = "high" | "medium" | "low";
export interface ProjectRisk { risk: string; severity: RiskSeverity; mitigation: string }
export interface StoryMap { backbone: string[]; slices: StoryMapSlice[]; milestones: string[]; risks: ProjectRisk[] }

export interface TaskEstimate { title: string; estimateHours: number }
export interface EstimateForecast { expectedHours: number; p50: number; p80: number; p95: number; iterations: number; calibrated: boolean }
