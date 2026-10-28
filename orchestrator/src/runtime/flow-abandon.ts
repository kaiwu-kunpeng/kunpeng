import os from "node:os";
import { FlowTracker } from "./flowstate.js";

export interface AbandonFlowResult {
  ok: boolean;
  error?: string;
}

export async function abandonFlow(flowDir: string, flowId: string, now: () => number = Date.now): Promise<AbandonFlowResult> {
  if (!flowId.trim()) return { ok: false, error: "缺 flowId" };

  const tracker = new FlowTracker(flowDir, now);
  const flow = await tracker.read(flowId);
  if (flow === null) return { ok: false, error: `未知流 ${flowId}` };

  if (flow.status === "running" && typeof flow.pid === "number" && flow.pid !== process.pid && (!flow.host || flow.host === os.hostname())) {
    try {
      process.kill(flow.pid, 0);
      process.kill(flow.pid, "SIGTERM");
    } catch {
      // 进程可能已经退出；状态收敛仍然应该继续。
    }
  }

  const out = await tracker.mutate(flowId, (flow) => {
    const t = now();
    flow.status = "rolled-back";
    flow.stage = "done";
    flow.agentActive = false;
    delete flow.humanGate;
    if (flow.failureReason === undefined) {
      flow.failureReason = flow.blocker?.trim()
        ? `[abandoned] 人工放弃该流；放弃前卡点：${flow.blocker}`
        : "[abandoned] 人工放弃该流";
    }
    delete flow.blocker;
    flow.updatedAt = t;
    flow.history = [...(Array.isArray(flow.history) ? flow.history : []), { stage: "abandoned", at: t }];
  });
  if (out === null) return { ok: false, error: `未知流 ${flowId}` };
  return { ok: true };
}
