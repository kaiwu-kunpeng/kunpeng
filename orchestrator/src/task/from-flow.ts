import type { TaskStatus } from "./model.js";

type FlowTaskProjectionInput = {
  status?: string;
  stage?: string;
  gate?: string | null;
  updatedAt?: number;
};

type FlowTaskInput = FlowTaskProjectionInput & {
  flowId: string;
  requirement?: string;
};

type FlowTaskProjection = {
  id: string;
  title: string;
  status: TaskStatus;
  updatedAt?: number;
};

const VERIFYING_STAGES = new Set(["verify", "audit"]);
const RUNNING_STAGES = new Set(["spec", "design", "implement", "review"]);

export function taskStatusFromFlow(flow: FlowTaskProjectionInput): TaskStatus {
  // 门优先于 verified：verified+挂人工门=正等人拍板,是「待审」不是「已交付」——今日页待审桶的主要来源就是它。
  if (flow.gate) {
    return "needs-review";
  }
  if (flow.status === "verified") {
    return "delivered";
  }
  if (flow.status === "rolled-back") {
    return "blocked";
  }
  if (flow.stage && VERIFYING_STAGES.has(flow.stage)) {
    return "verifying";
  }
  if (flow.stage && RUNNING_STAGES.has(flow.stage)) {
    return "running";
  }
  return "draft";
}

export function taskFromFlow(flow: FlowTaskInput): FlowTaskProjection {
  return {
    id: flow.flowId,
    title: flow.requirement?.split("\n")[0] ?? flow.flowId,
    status: taskStatusFromFlow(flow),
    updatedAt: flow.updatedAt,
  };
}
