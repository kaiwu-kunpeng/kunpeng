export interface PlanFlow { id: string; title: string; requirement: string; acceptanceCmd?: string; }
export interface PlanPhase { title: string; flows: PlanFlow[]; }
export interface PlanModel { phases: PlanPhase[]; }

export interface PlanFlowResult { flowId: string; phase: number; status: "verified" | "rolled-back" | "stopped"; }
export interface PlanResult {
  planId: string;
  status: "verified" | "stopped";
  integrationBranch: string;
  flows: PlanFlowResult[];
  stoppedAtPhase?: number;
  integrationErrors?: string[];   // 集成 tsc/检查门拦下的新错（跨流类型不一致等），非空=停在该门
}
