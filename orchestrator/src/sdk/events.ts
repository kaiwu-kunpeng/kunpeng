export type KunpengEvent =
  | { type: "phase"; planId: string; phase: string; index: number; total: number }
  | { type: "flow"; planId?: string; flowId: string; stage: string; status: string }
  | { type: "token"; planId?: string; flowId?: string; stage?: string; text: string }
  | { type: "usage"; planId?: string; flowId?: string; stage?: string; input?: number; output?: number; model?: string }
  | { type: "gate"; planId?: string; flowId?: string; what: string; detail: string }
  | { type: "done"; planId?: string; flowId?: string; status: string };

export type OnEvent = (e: KunpengEvent) => void;
