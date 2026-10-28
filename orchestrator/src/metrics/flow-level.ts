import { classify, type AutomationLevel, type SessionSignals } from "./automation-level.js";

export interface FlowLike {
  requirement?: string;
  elapsedMs?: number;
  history?: { stage: string; at?: number }[];
}

export function deriveFlowSignals(flow: FlowLike): SessionSignals {
  const history = flow.history ?? [];
  const gateTouches = history.filter((h) => /gate|blocker|review/i.test(h.stage)).length;
  return {
    durationMin: (flow.elapsedMs ?? 0) / 60000,
    userMsgs: 1 + gateTouches,
    userChars: (flow.requirement ?? "").length,
  };
}

export function flowLevel(flow: FlowLike): AutomationLevel {
  return classify(deriveFlowSignals(flow));
}
