import type { ArtifactSummary } from "../../artifacts/store.js";
import type { FlowState } from "../../runtime/flowstate.js";
import { isRaiseBlocker } from "../../runtime/raise-blocker.js";
import type { PreReview } from "../pre-review.js";
import { computeSystemLight } from "../state-dashboard-slim.js";
import type { ActivityTruth, FlowWithLight } from "../state-types.js";
import { relTime } from "../../util/rel-time.js";

export function flowHumanGates(
  flows: Pick<FlowState, "status" | "humanGate" | "flowId">[],
) {
  return flows
    .filter((f) => f.humanGate && f.status === "verified")
    .map((f) => ({
      what: f.humanGate!.gate,
      detail: f.humanGate!.what,
      flowId: f.flowId,
      preReview: f.humanGate!.preReview as PreReview | undefined,
    }));
}

export function flowBlockers(
  flows: Pick<FlowState, "status" | "blocker" | "flowId" | "stage">[],
) {
  return flows
    .filter((f) => f.blocker && (f.status === "running" || f.status === "crashed" || (f.status === "stopped" && isRaiseBlocker(f.blocker))))
    .map((f) => ({ flowId: f.flowId, stage: f.stage, reason: f.blocker! }));
}

export function collectFlowTruth({ allFlows, arts, now }: {
  allFlows: FlowState[];
  arts: ArtifactSummary[];
  now: number;
}) {
  const sorted = allFlows.sort((a, b) => b.updatedAt - a.updatedAt);

  // Compute ETA: average duration of finished flows
  const finished = sorted.filter((f) => f.status !== "running" && f.status !== "crashed" && f.status !== "stopped" && f.updatedAt > f.startedAt);
  const avgMs = finished.length
    ? finished.reduce((sum, f) => sum + (f.updatedAt - f.startedAt), 0) / finished.length
    : 90000;

  // Per-flow light and ETA
  const flows: FlowWithLight[] = sorted.map((f) => {
    // 与系统灯同语义：crashed 或「非终态流挂 active blocker」→红；回滚/verified→绿（回滚已自愈，不再标红）。
    const light: "red" | "green" =
      f.status === "crashed" || (Boolean(f.blocker) && f.status !== "verified" && f.status !== "rolled-back")
        ? "red" : "green";
    const fw: FlowWithLight = { ...f, light };
    if (f.status === "running") {
      fw.etaRemainingMs = Math.max(0, avgMs - (now - f.startedAt));
      fw.elapsedMs = now - f.startedAt;
    } else if (f.status === "crashed") {
      fw.elapsedMs = now - f.startedAt;
    } else if (f.status === "stopped") {
      fw.elapsedMs = now - f.startedAt;
    }
    return fw;
  });

  // running 只含真·运行中流：crashed 绝不计入，否则 board.json activeFlows / 「运行中流」计数 / 「调度 N 条流」
  // 会把已崩溃流当成「在跑」对外虚报并发度（board.json 是跨工具契约）。crashed 经 blockers + 红灯如实暴露。
  const running = flows.filter((f) => f.status === "running");
  const agents = 1 + running.filter((f) => f.agentActive).length;
  const blockers = flowBlockers(flows);

  // Human gates: from flow humanGate fields + draft proposals
  const humanGates: { what: string; detail: string; flowId: string; preReview?: PreReview }[] = [];
  humanGates.push(...flowHumanGates(flows));
  for (const a of arts) {
    if (a.kind === "proposal" && a.status === "draft") {
      humanGates.push({ what: "批准进化提案 (人工门#2)", detail: a.id, flowId: a.id, preReview: (a.meta as { preReview?: PreReview } | undefined)?.preReview });
    }
  }

  // systemLight
  const systemLight = computeSystemLight(flows, arts);

  // agentAssignments
  const agentAssignments: { agent: string; doing: string; backend?: string; fellBack?: boolean }[] = [
    { agent: "主 agent", doing: running.length ? `调度 ${running.length} 条流` : "空闲待命" },
  ];
  for (const f of running) {
    if (f.agentActive) {
      agentAssignments.push({ agent: "子 agent", doing: `${f.flowId} @ ${f.stage}`, backend: f.backend, fellBack: f.fellBack });
    }
  }

  const verifiedFlows = flows.filter((f) => f.status === "verified").length;
  const rolledBackFlows = flows.filter((f) => f.status === "rolled-back").length;
  const finishedFlows = verifiedFlows + rolledBackFlows;
  const activity: ActivityTruth = {
    total: flows.length,
    verified: verifiedFlows,
    rolledBack: rolledBackFlows,
    successRate: finishedFlows === 0 ? 1 : verifiedFlows / finishedFlows,
    recent: flows.slice(0, 6).map((f) => ({
      flowId: f.flowId,
      status: f.status,
      stage: f.stage,
      updatedAt: f.updatedAt,
      agoText: relTime(now - f.updatedAt),
    })),
  };

  return { flows, running, agents, blockers, humanGates, systemLight, agentAssignments, activity };
}
